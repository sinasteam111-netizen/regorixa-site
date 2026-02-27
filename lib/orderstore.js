// lib/orderstore.js
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  ensureDir,
  withFileLock,
  atomicWriteJson,
  readJsonFileSafe,
} from "./fileStoreSafe";

/**
 * ✅ Data dir strategy:
 * - Prefer project ".data" (local/VPS)
 * - Fallback to OS tmp dir (serverless-like environments may only allow /tmp)
 *
 * نکته: در serverless هم /tmp معمولاً ephemeral است، ولی حداقل از silent-fail جلوگیری می‌کند.
 * برای production پایدار: DB بهترین راه است.
 */
function pickDataDir() {
  const fromEnv = String(process.env.REGORA_DATA_DIR || process.env.REGORIXA_DATA_DIR || "").trim();
  if (fromEnv) return path.isAbsolute(fromEnv) ? fromEnv : path.join(process.cwd(), fromEnv);

  // default .data
  return path.join(process.cwd(), ".data");
}

let DATA_DIR = pickDataDir();
let ORDERS_FILE = path.join(DATA_DIR, "orders.json");
let TXID_INDEX_FILE = path.join(DATA_DIR, "txidIndex.json");

// --- In-process mutex (per runtime instance) ---
const _locks = globalThis.__regorixa_locks || (globalThis.__regorixa_locks = {});
function withLock(key, fn) {
  const prev = _locks[key] || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  _locks[key] = next.finally(() => {});
  return next;
}

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normId(id) {
  return String(id || "").trim();
}

function normTxid(x) {
  let s = String(x || "").trim();
  if (!s) return "";
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  s = s.replace(/\s+/g, "");
  return s.toLowerCase();
}

async function canWriteDir(dir) {
  try {
    await ensureDir(dir);
    const testFile = path.join(dir, `.write_test_${Date.now()}.tmp`);
    await fs.writeFile(testFile, "ok");
    await fs.unlink(testFile);
    return true;
  } catch {
    return false;
  }
}

async function ensureDataDirWritable() {
  // Try chosen DATA_DIR
  if (await canWriteDir(DATA_DIR)) return;

  // Fallback: /tmp (or OS temp)
  const tmpBase = process.env.TMPDIR || "/tmp" || os.tmpdir();
  const fallback = path.join(tmpBase, "regorixa-data");

  if (await canWriteDir(fallback)) {
    DATA_DIR = fallback;
    ORDERS_FILE = path.join(DATA_DIR, "orders.json");
    TXID_INDEX_FILE = path.join(DATA_DIR, "txidIndex.json");
    return;
  }

  // If none works, throw explicit error
  throw new Error("DATA_DIR_NOT_WRITABLE");
}

async function readOrdersUnsafe() {
  try {
    await fs.access(ORDERS_FILE);
  } catch {
    return [];
  }
  return await readJsonFileSafe(ORDERS_FILE, [], {
    backupOnCorrupt: true,
    backupDir: DATA_DIR,
  });
}

async function readIndexUnsafe() {
  try {
    await fs.access(TXID_INDEX_FILE);
  } catch {
    return {};
  }
  const v = await readJsonFileSafe(TXID_INDEX_FILE, {}, {
    backupOnCorrupt: true,
    backupDir: DATA_DIR,
  });
  return v && typeof v === "object" ? v : {};
}

function buildTxidIndex(orders) {
  const index = {};
  for (const o of Array.isArray(orders) ? orders : []) {
    const id = normId(o?.id);
    const tx = normTxid(o?.txidNorm || o?.txid);
    if (!id || !tx) continue;
    if (!index[tx]) index[tx] = id;
  }
  return index;
}

function ensureOrderShape(order) {
  const o = { ...(order || {}) };
  if (!normId(o.id)) throw new Error("ORDER_ID_REQUIRED");

  const now = new Date().toISOString();
  if (!o.createdAt) o.createdAt = now;
  if (!o.updatedAt) o.updatedAt = now;

  // Normalize txidNorm if txid present
  if (!o.txidNorm && o.txid) o.txidNorm = normTxid(o.txid);

  return o;
}

/**
 * ✅ Self-heal txid index:
 * اگر txidIndex خراب یا mismatch شد، دوباره از روی orders ساخته می‌شود.
 */
async function ensureIndexConsistency(orders, index) {
  const built = buildTxidIndex(orders);

  // quick check: sizes or any mismatch
  const keysA = Object.keys(built);
  const keysB = Object.keys(index || {});
  if (keysA.length !== keysB.length) return built;

  for (const k of keysA) {
    if (!index[k] || normId(index[k]) !== normId(built[k])) return built;
  }
  return index;
}

// -----------------------------

export async function readOrders() {
  await ensureDataDirWritable();
  return await readOrdersUnsafe();
}

/**
 * Write all orders and rebuild index
 */
export async function writeOrders(orders) {
  const nextOrders = (Array.isArray(orders) ? orders : []).map(ensureOrderShape);

  return await withLock(ORDERS_FILE, async () => {
    return await withFileLock(ORDERS_FILE, async () => {
      await ensureDataDirWritable();

      const index = buildTxidIndex(nextOrders);

      await atomicWriteJson(ORDERS_FILE, nextOrders);
      await atomicWriteJson(TXID_INDEX_FILE, index);

      return nextOrders;
    });
  });
}

export async function replaceOrders(orders) {
  return await writeOrders(orders);
}

export async function getOrdersByEmail(email) {
  const emailNorm = normEmail(email);
  if (!emailNorm) return [];
  const orders = await readOrders();
  return orders.filter((o) => normEmail(o?.userEmail) === emailNorm);
}

export async function txidExists(txid, { excludeOrderId } = {}) {
  const tx = normTxid(txid);
  if (!tx) return false;

  return await withLock(ORDERS_FILE, async () => {
    return await withFileLock(ORDERS_FILE, async () => {
      await ensureDataDirWritable();

      const orders = await readOrdersUnsafe();
      let index = await readIndexUnsafe();
      index = await ensureIndexConsistency(orders, index);

      // اگر مجبور شدیم index رو rebuild کنیم، ذخیره‌اش کن تا بعدی‌ها سریع‌تر باشند
      await atomicWriteJson(TXID_INDEX_FILE, index);

      const existingOrderId = index[tx];
      if (!existingOrderId) return false;

      if (excludeOrderId && normId(existingOrderId) === normId(excludeOrderId)) {
        return false;
      }

      return true;
    });
  });
}

export async function addOrder(order) {
  const safeOrder = ensureOrderShape(order);

  return await withLock(ORDERS_FILE, async () => {
    return await withFileLock(ORDERS_FILE, async () => {
      await ensureDataDirWritable();

      const orders = await readOrdersUnsafe();
      let index = await readIndexUnsafe();
      index = await ensureIndexConsistency(orders, index);

      const txNorm = normTxid(safeOrder?.txidNorm || safeOrder?.txid);
      if (txNorm && index[txNorm]) {
        const err = new Error("TXID_DUPLICATE");
        err.code = "TXID_DUPLICATE";
        throw err;
      }

      orders.push(safeOrder);
      if (txNorm) index[txNorm] = safeOrder.id;

      await atomicWriteJson(ORDERS_FILE, orders);
      await atomicWriteJson(TXID_INDEX_FILE, index);

      return safeOrder;
    });
  });
}

export async function updateOrderById(id, patch) {
  const idNorm = normId(id);
  if (!idNorm) return null;

  return await withLock(ORDERS_FILE, async () => {
    return await withFileLock(ORDERS_FILE, async () => {
      await ensureDataDirWritable();

      const orders = await readOrdersUnsafe();
      let index = await readIndexUnsafe();
      index = await ensureIndexConsistency(orders, index);

      const idx = orders.findIndex((o) => normId(o?.id) === idNorm);
      if (idx === -1) return null;

      const old = orders[idx];
      const oldTx = normTxid(old?.txidNorm || old?.txid);

      const next = ensureOrderShape({
        ...old,
        ...patch,
        updatedAt: new Date().toISOString(),
      });

      const newTx = normTxid(next?.txidNorm || next?.txid);

      if (newTx && newTx !== oldTx && index[newTx]) {
        const err = new Error("TXID_DUPLICATE");
        err.code = "TXID_DUPLICATE";
        throw err;
      }

      if (oldTx && index[oldTx] === idNorm) delete index[oldTx];
      if (newTx) index[newTx] = idNorm;

      orders[idx] = next;

      await atomicWriteJson(ORDERS_FILE, orders);
      await atomicWriteJson(TXID_INDEX_FILE, index);

      return next;
    });
  });
}

export async function deleteOrderById(id) {
  const idNorm = normId(id);
  if (!idNorm) return false;

  return await withLock(ORDERS_FILE, async () => {
    return await withFileLock(ORDERS_FILE, async () => {
      await ensureDataDirWritable();

      const orders = await readOrdersUnsafe();
      let index = await readIndexUnsafe();
      index = await ensureIndexConsistency(orders, index);

      const idx = orders.findIndex((o) => normId(o?.id) === idNorm);
      if (idx === -1) return false;

      const old = orders[idx];
      const oldTx = normTxid(old?.txidNorm || old?.txid);

      if (oldTx && index[oldTx] === idNorm) delete index[oldTx];

      orders.splice(idx, 1);

      await atomicWriteJson(ORDERS_FILE, orders);
      await atomicWriteJson(TXID_INDEX_FILE, index);

      return true;
    });
  });
}
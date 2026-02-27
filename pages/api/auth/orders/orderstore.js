import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const ORDERS_LOCK = path.join(DATA_DIR, "orders.lock");

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// --- Lock (best-effort cross-process) ---
async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function acquireLock(lockPath, { timeoutMs = 10_000, retryMs = 50 } = {}) {
  const start = Date.now();
  await ensureDataDir();

  // Try to create lock file exclusively
  while (true) {
    try {
      // 'wx' => fail if exists
      const handle = await fs.open(lockPath, "wx");
      // Write pid/timestamp (debug-friendly; no functional dependency)
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
          "utf8"
        );
      } catch {}
      return handle;
    } catch (e) {
      if (e && e.code !== "EEXIST") throw e;

      if (Date.now() - start > timeoutMs) {
        const err = new Error("Lock timeout");
        err.code = "LOCK_TIMEOUT";
        throw err;
      }
      await sleep(retryMs);
    }
  }
}

async function releaseLock(handle, lockPath) {
  try {
    await handle?.close?.();
  } catch {}
  try {
    await fs.unlink(lockPath);
  } catch {}
}

async function withFileLock(lockPath, fn, opts) {
  const handle = await acquireLock(lockPath, opts);
  try {
    return await fn();
  } finally {
    await releaseLock(handle, lockPath);
  }
}

// --- Safe read ---
async function readJsonArraySafe(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// --- Atomic write ---
async function writeJsonAtomic(filePath, data) {
  await ensureDataDir();

  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.tmp.${process.pid}.${Date.now()}`);

  const json = JSON.stringify(data, null, 2);

  // Write to temp, fsync, then rename (atomic on same filesystem)
  const fh = await fs.open(tmp, "w");
  try {
    await fh.writeFile(json, "utf8");
    try {
      await fh.sync(); // best-effort durability
    } catch {}
  } finally {
    try {
      await fh.close();
    } catch {}
  }

  await fs.rename(tmp, filePath);
}

// ------------------------------------------------------------------
// Public API (exports) - signatures and behavior preserved
// ------------------------------------------------------------------

export async function readOrders() {
  await ensureDataDir();
  return await readJsonArraySafe(ORDERS_FILE);
}

export async function writeOrders(orders) {
  // ✅ lock + atomic
  await withFileLock(ORDERS_LOCK, async () => {
    await writeJsonAtomic(ORDERS_FILE, Array.isArray(orders) ? orders : []);
  });
}

export async function addOrder(order) {
  // ✅ جلوگیری از race: read-modify-write داخل lock
  return await withFileLock(ORDERS_LOCK, async () => {
    const orders = await readJsonArraySafe(ORDERS_FILE);
    orders.unshift(order); // جدیدها بالا (همان رفتار قبلی)
    await writeJsonAtomic(ORDERS_FILE, orders);
    return order;
  });
}

export async function getOrdersByEmail(email) {
  const emailNorm = String(email || "").trim().toLowerCase();
  const orders = await readOrders();
  return orders.filter((o) => String(o.userEmail || "").toLowerCase() === emailNorm);
}

export async function updateOrderById(id, patch) {
  // ✅ جلوگیری از race: read-modify-write داخل lock
  return await withFileLock(ORDERS_LOCK, async () => {
    const orders = await readJsonArraySafe(ORDERS_FILE);
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1) return null;

    const next = { ...orders[idx], ...patch, updatedAt: new Date().toISOString() };
    orders[idx] = next;
    await writeJsonAtomic(ORDERS_FILE, orders);
    return next;
  });
}

export async function deleteOrderById(id) {
  // ✅ جلوگیری از race: read-modify-write داخل lock
  return await withFileLock(ORDERS_LOCK, async () => {
    const orders = await readJsonArraySafe(ORDERS_FILE);
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1) return false;

    orders.splice(idx, 1);
    await writeJsonAtomic(ORDERS_FILE, orders);
    return true;
  });
}

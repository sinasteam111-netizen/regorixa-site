// lib/withdrawalsStore.js
import fs from "fs/promises";
import path from "path";
import { ensureDir, withFileLock, atomicWriteJson, readJsonFileSafe } from "./fileStoreSafe";

const DATA_DIR = path.join(process.cwd(), ".data");
const WITHDRAWALS_FILE = path.join(DATA_DIR, "withdrawals.json");
const AUDIT_FILE = path.join(DATA_DIR, "withdrawals_audit.jsonl");

async function ensureData() {
  await ensureDir(DATA_DIR);
}

/**
 * Read withdrawals:
 * - missing => []
 * - corrupt => [] + backup best-effort
 */
export async function readWithdrawals() {
  await ensureData();

  try {
    await fs.access(WITHDRAWALS_FILE);
  } catch {
    return [];
  }

  return await readJsonFileSafe(WITHDRAWALS_FILE, [], {
    backupOnCorrupt: true,
    backupDir: DATA_DIR,
  });
}

export async function writeWithdrawals(rows) {
  await ensureData();
  const arr = Array.isArray(rows) ? rows : [];
  await atomicWriteJson(WITHDRAWALS_FILE, arr);
}

/**
 * Run critical section with multi-process lock (withdrawals.json.lock)
 */
export async function withWithdrawalsLock(fn, opts = {}) {
  await ensureData();
  return await withFileLock(WITHDRAWALS_FILE, fn, opts);
}
/**
 * Audit log append (jsonl)
 * - best-effort
 * - can await or fire-and-forget
 * - sanitizes payload + enforces timestamp
 */
export async function appendWithdrawalsAudit(event, { awaitWrite = false } = {}) {
  const cleanNoCrlf = (v) => String(v || "").replace(/[\r\n]+/g, " ").trim();
  const clampLen = (v, max = 5000) => {
    const s = String(v || "");
    return s.length > max ? s.slice(0, max) + "…" : s;
  };

  const sanitize = (obj, depth = 0) => {
    if (obj == null) return obj;
    if (depth > 4) return "[TruncatedDepth]";
    if (typeof obj === "string") return clampLen(cleanNoCrlf(obj), 2000);
    if (typeof obj === "number" || typeof obj === "boolean") return obj;
    if (Array.isArray(obj)) return obj.slice(0, 50).map((x) => sanitize(x, depth + 1));
    if (typeof obj === "object") {
      const out = {};
      for (const k of Object.keys(obj).slice(0, 50)) out[String(k)] = sanitize(obj[k], depth + 1);
      return out;
    }
    return clampLen(cleanNoCrlf(String(obj)), 2000);
  };

  const doWrite = async () => {
    try {
      await ensureData();
      const row = {
        ...sanitize(event),
        at: event?.at ? cleanNoCrlf(event.at) : new Date().toISOString(),
      };
      await fs.appendFile(AUDIT_FILE, JSON.stringify(row) + "\n", "utf8");
    } catch {}
  };

  if (awaitWrite) return await doWrite();
  doWrite().catch(() => {});
}
export function getWithdrawalsPaths() {
  return { DATA_DIR, WITHDRAWALS_FILE, AUDIT_FILE };
}

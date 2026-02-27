// lib/fileStoreSafe.js
import fs from "fs/promises";
import fssync from "fs";
import path from "path";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Multi-process lock با فایل: <target>.lock
 */
export async function withFileLock(targetPath, fn, opts = {}) {
  const lockPath = `${targetPath}.lock`;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const retryMs = opts.retryMs ?? 60;
  const start = Date.now();

  await ensureDir(path.dirname(targetPath));

  while (true) {
    try {
      const fh = await fs.open(lockPath, "wx");
      try {
        return await fn();
      } finally {
        try { await fh.close(); } catch {}
        try { await fs.unlink(lockPath); } catch {}
      }
    } catch (e) {
      if (e && e.code !== "EEXIST") throw e;
      if (Date.now() - start > timeoutMs) {
        const err = new Error("LOCK_TIMEOUT");
        err.code = "LOCK_TIMEOUT";
        throw err;
      }
      await sleep(retryMs);
    }
  }
}

/**
 * Atomic write: temp + fsync file + rename + fsync dir (best effort)
 */
export async function atomicWriteFile(filePath, data, encoding = "utf8") {
  await ensureDir(path.dirname(filePath));

  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.tmp.${process.pid}.${Date.now()}`);

  const fh = await fs.open(tmp, "w");
  try {
    await fh.writeFile(data, encoding);
    try { await fh.sync(); } catch {}
  } finally {
    try { await fh.close(); } catch {}
  }

  await fs.rename(tmp, filePath);

  try {
    const dfd = fssync.openSync(dir, "r");
    try { fssync.fsyncSync(dfd); } finally { fssync.closeSync(dfd); }
  } catch {}
}

export async function atomicWriteJson(filePath, value) {
  const json = JSON.stringify(value, null, 2);
  await atomicWriteFile(filePath, json, "utf8");
}

/**
 * Safe JSON read:
 * - ENOENT => fallbackValue
 * - parse error => (اختیاری) backup raw و fallbackValue
 * توجه: برای “عدم تغییر رفتار”، اگر قبلاً throw می‌کردید، از fallback استفاده نکنید.
 */
export async function readJsonFileSafe(filePath, fallbackValue, opts = {}) {
  const backupOnCorrupt = opts.backupOnCorrupt ?? false;
  const backupDir = opts.backupDir ?? path.dirname(filePath);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const v = JSON.parse(raw || "null");
    return v;
  } catch (e) {
    if (e && e.code === "ENOENT") return fallbackValue;

    if (backupOnCorrupt) {
      try {
        const raw = await fs.readFile(filePath, "utf8").catch(() => "");
        if (raw) {
          await ensureDir(backupDir);
          const base = path.basename(filePath);
          const bak = path.join(backupDir, `${base}.corrupt.${Date.now()}.bak.json`);
          await fs.writeFile(bak, raw, "utf8");
        }
      } catch {}
    }
    return fallbackValue;
  }
}

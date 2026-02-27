import fs from "fs/promises";
import path from "path";
import { requireAdmin } from "../../../lib/requireAdmin";
import { findUserByEmail } from "../../../lib/userStore";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp } from "../../../lib/ipUa";

const DATA_DIR = path.join(process.cwd(), ".data");
const filePath = path.join(DATA_DIR, "notifications.json");
const lockPath = path.join(DATA_DIR, "notifications.lock");

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function acquireLock(lockFile, { timeoutMs = 10_000, retryMs = 50 } = {}) {
  const start = Date.now();
  await ensureDataDir();

  while (true) {
    try {
      const handle = await fs.open(lockFile, "wx");
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), "utf8");
      } catch {}
      return handle;
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
      if (Date.now() - start > timeoutMs) {
        const err = new Error("Lock timeout");
        err.code = "LOCK_TIMEOUT";
        throw err;
      }
      await sleep(retryMs);
    }
  }
}

async function releaseLock(handle, lockFile) {
  try {
    await handle?.close?.();
  } catch {}
  try {
    await fs.unlink(lockFile);
  } catch {}
}

async function withLock(fn) {
  const h = await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await releaseLock(h, lockPath);
  }
}

async function readNotifsSafe() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeNotifsAtomic(list) {
  await ensureDataDir();
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.tmp.${process.pid}.${Date.now()}`);

  const json = JSON.stringify(list, null, 2);
  const fh = await fs.open(tmp, "w");
  try {
    await fh.writeFile(json, "utf8");
    try {
      await fh.sync();
    } catch {}
  } finally {
    try {
      await fh.close();
    } catch {}
  }
  await fs.rename(tmp, filePath);
}

export default async function handler(req, res) {
  try {
    noStore(res);

    if (req.method !== "POST") return res.status(405).json({ ok: false });

    // ✅ rate limit (چون write است)
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`admin:notifs:create:${ip}:${p}`, { windowMs: 60 * 1000, max: 30 });
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {
      // fail-open برای حفظ رفتار کلی
    }

    // ✅ امنیت واقعی: فقط admin
    const auth = await requireAdmin(req, res, {
      rateLimitKeyPrefix: "admin:notifs:create",
      setNoStoreHeader: true,
    });
    if (!auth) return;

    const { email, title, message } = req.body || {};
    if (!email || !message) return res.status(400).json({ ok: false });

    const emailNorm = String(email).trim().toLowerCase();

    // ✅ target باید کاربر واقعی باشد (security + data integrity)
    const target = await findUserByEmail(emailNorm);
    if (!target?.email) {
      // بدون تغییر الگوی پیام‌ها: همون ok:false
      return res.status(400).json({ ok: false });
    }

    // ✅ lock + atomic write
    await withLock(async () => {
      const list = await readNotifsSafe();
      list.unshift({
        id: Date.now().toString(), // همون رفتار قبلی
        email: emailNorm,
        title: title || "Notification",
        message: String(message),
        unread: true,
        createdAt: new Date().toISOString(),
      });
      await writeNotifsAtomic(list);
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("notifications create error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

// pages/api/wallet/save.js
import fs from "fs/promises";
import path from "path";
import { getSession } from "../../../lib/auth";
import { findUserByEmail } from "../../../lib/userStore";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp, getUa } from "../../../lib/ipUa";
import { verifyCsrf, rejectCsrf } from "../../../lib/csrf";
import { applySecurityHeaders } from "../../../lib/securityHeaders";

const DATA_DIR = path.join(process.cwd(), ".data");
const filePath = path.join(DATA_DIR, "wallets.json");
const lockPath = path.join(DATA_DIR, "wallets.lock");

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
      const h = await fs.open(lockFile, "wx");
      try {
        await h.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), "utf8");
      } catch {}
      return h;
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

async function readWalletsSafe() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

async function writeWalletsAtomic(wallets) {
  await ensureDataDir();
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.tmp.${process.pid}.${Date.now()}`);

  const json = JSON.stringify(wallets, null, 2);
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

function cleanWalletStr(v) {
  // فعلاً permissive، فقط trim + طول محدود (DB-ready)
  return String(v || "").trim().slice(0, 200);
}

export default async function handler(req, res) {
  try {
    noStore(res);
    applySecurityHeaders(res);

    // ✅ CSRF (برای POST/PUT/PATCH/DELETE فعال است)
    if (!verifyCsrf(req)) return rejectCsrf(res);

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ (اختیاری ولی مفید) سخت‌گیری روی content-type برای کاهش درخواست‌های عجیب
    const ct = String(req.headers["content-type"] || "");
    if (ct && !ct.includes("application/json")) {
      return res.status(415).json({ ok: false, error: "Unsupported Media Type" });
    }

    // ✅ rate limit (write حساس)
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`wallets:update:${ip}:${p}`, { windowMs: 60 * 1000, max: 30 });
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {
      // fail-open برای حفظ رفتار
    }

    const session = getSession(req);
    if (!session?.email) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const emailNorm = String(session.email || "").trim().toLowerCase();
    const user = await findUserByEmail(emailNorm);
    if (!user?.email) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const { wallet } = req.body || {};
    const w = cleanWalletStr(wallet);
    if (!w) return res.status(400).json({ ok: false, error: "wallet is required" });

    const key = String(user.email || "").trim().toLowerCase();

    await withLock(async () => {
      const wallets = await readWalletsSafe();
      wallets[key] = {
        wallet: w,
        updatedAt: new Date().toISOString(),
        // Optional audit fields (خروجی تغییر نمی‌کند)
        lastIp: (() => { try { return getIp(req); } catch { return undefined; } })(),
        lastUa: (() => { try { return getUa(req); } catch { return undefined; } })(),
      };
      await writeWalletsAtomic(wallets);
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("wallets/update error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
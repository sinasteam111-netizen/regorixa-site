import fs from "fs/promises";
import path from "path";
import { getSession } from "../../../lib/auth";
import { findUserByEmail } from "../../../lib/userStore";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp } from "../../../lib/ipUa";

const DATA_DIR = path.join(process.cwd(), ".data");
const filePath = path.join(DATA_DIR, "tickets.json");
const lockPath = path.join(DATA_DIR, "tickets.lock");

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

async function readTicketsSafe() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeTicketsAtomic(list) {
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

function cleanStr(v, max) {
  return String(v || "").trim().slice(0, max);
}

export default async function handler(req, res) {
  try {
    noStore(res);

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    // ✅ rate limit (create ticket)
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`tickets:create:${ip}:${p}`, { windowMs: 60 * 1000, max: 10 });
      if (!rl.ok) {
        return res.status(429).json({ error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {
      // fail-open برای حفظ رفتار
    }

    const { title, message } = req.body || {};
    if (!title || !message) return res.status(400).json({ error: "title and message are required" });

    // ✅ user واقعی از session (مثل me.js)
    const session = getSession(req);
    if (!session) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const emailNorm = String(session.email || "").trim().toLowerCase();
    const dbUser = await findUserByEmail(emailNorm);
    if (!dbUser) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const newTicket = {
      id: Date.now().toString(),
      title: cleanStr(title, 200),
      message: cleanStr(message, 5000),
      status: "open",
      createdAt: new Date().toISOString(),

      user: {
        id: String(dbUser.id),
        email: String(dbUser.email || ""),
        name: String(dbUser.firstName || dbUser.email || ""),
      },

      adminReply: "",
      repliedAt: null,

      unreadByAdmin: true,
      unreadByUser: false,
    };

    // ✅ lock + atomic write (ضد race/corrupt)
    await withLock(async () => {
      const tickets = await readTicketsSafe();
      tickets.unshift(newTicket);
      await writeTicketsAtomic(tickets);
    });

    return res.status(200).json({ success: true, ticket: newTicket });
  } catch (e) {
    console.error("tickets/create error:", e);
    // خروجی قبلی برای خطاهای unexpected مشخص نبود، ولی بهتره 500 بدهیم
    return res.status(500).json({ error: "Server error" });
  }
}

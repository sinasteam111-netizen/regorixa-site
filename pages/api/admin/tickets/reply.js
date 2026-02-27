// pages/api/admin/tickets/reply.js
import fs from "fs/promises";
import path from "path";
import { requireAdmin } from "../../../../lib/requireAdmin";
import { rateLimit } from "../../../../lib/rateLimit";

const DATA_DIR = path.join(process.cwd(), ".data");
const filePath = path.join(DATA_DIR, "tickets.json");

// -------------------- lock --------------------
const _locks = globalThis.__regorixa_locks || (globalThis.__regorixa_locks = {});
function withLock(key, fn) {
  const prev = _locks[key] || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  _locks[key] = next;
  return next;
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readTickets() {
  await ensureDir();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function atomicWriteTickets(tickets) {
  await ensureDir();
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  const arr = Array.isArray(tickets) ? tickets : [];
  await fs.writeFile(tmp, JSON.stringify(arr, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

function clampReply(x, max = 5000) {
  const s = String(x ?? "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ admin gate (session + real user + role)
    const gate = await requireAdmin(req, res, { allowRoles: ["admin", "super_admin"] });
    if (!gate) return;

    // ✅ rate limit (per admin) to avoid spam / accidental loops
    const adminEmail = String(gate.user?.email || "").toLowerCase();
    const rl = rateLimit(`tickets:reply:${adminEmail}`, { windowMs: 60_000, max: 120 });
    if (!rl.ok) {
      return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
    }

    const { ticketId, reply } = req.body || {};
    const id = String(ticketId || "").trim();
    const rep = clampReply(reply, 5000);

    if (!id || !rep) {
      return res.status(400).json({ ok: false, error: "ticketId and reply are required" });
    }

    const out = await withLock(filePath, async () => {
      const tickets = await readTickets();
      const idx = tickets.findIndex((x) => String(x?.id) === id);
      if (idx === -1) {
        return { status: 404, body: { ok: false, error: "Ticket not found" } };
      }

      const t = tickets[idx];

      t.adminReply = rep;
      t.repliedAt = new Date().toISOString();
      t.status = "answered";

      // ✅ وقتی ادمین جواب می‌دهد:
      // برای کاربر unread می‌شود تا Badge بیاید
      t.unreadByUser = true;

      // برای ادمین دیگر unread نیست
      t.unreadByAdmin = false;

      // (اختیاری) ثبت اینکه آخرین پاسخ توسط چه کسی بوده
      t.lastRepliedBy = { email: gate.user.email, at: t.repliedAt };

      tickets[idx] = t;

      await atomicWriteTickets(tickets);
      return { status: 200, body: { ok: true, ticket: t } };
    });

    return res.status(out.status).json(out.body);
  } catch (e) {
    console.error("admin/tickets/reply error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

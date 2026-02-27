// lib/auditLog.js
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.join(process.cwd(), ".data");
const AUDIT_DIR = path.join(DATA_DIR, "audit"); // روزانه فایل می‌سازیم

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function nowISO() {
  return new Date().toISOString();
}

function safeId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

function cleanNoCrlf(v) {
  return String(v || "").replace(/[\r\n]+/g, " ").trim();
}

function clampLen(v, max = 2000) {
  const s = String(v || "");
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function dayKeyUTC(ts = new Date()) {
  // فایل روزانه بر اساس تاریخ UTC
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function auditFilePath(day) {
  return path.join(AUDIT_DIR, `${day}.jsonl`);
}

/**
 * برای جلوگیری از log injection و سنگین شدن لاگ
 */
function sanitizeObject(obj, depth = 0) {
  if (obj == null) return obj;
  if (depth > 4) return "[TruncatedDepth]";
  if (typeof obj === "string") return clampLen(cleanNoCrlf(obj), 2000);
  if (typeof obj === "number" || typeof obj === "boolean") return obj;

  if (Array.isArray(obj)) {
    return obj.slice(0, 50).map((x) => sanitizeObject(x, depth + 1));
  }

  if (typeof obj === "object") {
    const out = {};
    const keys = Object.keys(obj).slice(0, 50);
    for (const k of keys) out[String(k)] = sanitizeObject(obj[k], depth + 1);
    return out;
  }

  return clampLen(cleanNoCrlf(String(obj)), 2000);
}

/**
 * event schema:
 * {
 *  id, ts,
 *  actor:{type,id,email,ip,ua},
 *  action, target:{type,id},
 *  ok, reason,
 *  before, after,
 *  meta
 * }
 */
export function makeAuditEvent({
  actor,
  action,
  target,
  ok = true,
  reason = null,
  before = null,
  after = null,
  meta = null,
  ts = nowISO(),
  id = null,
}) {
  const ev = {
    id: id || safeId(),
    ts,
    actor: sanitizeObject(
      actor || { type: "system", id: "system", email: null, ip: null, ua: null }
    ),
    action: clampLen(cleanNoCrlf(action || "unknown"), 200),
    target: sanitizeObject(target || { type: "unknown", id: null }),
    ok: Boolean(ok),
    reason: reason ? clampLen(cleanNoCrlf(reason), 500) : null,
    before: sanitizeObject(before),
    after: sanitizeObject(after),
    meta: sanitizeObject(meta),
  };
  return ev;
}

/**
 * append JSONL (روزانه). خیلی سبک + مناسب production.
 */
export async function appendAuditEvent(event, { day = null } = {}) {
  try {
    await ensureDir(AUDIT_DIR);
    const d = day || dayKeyUTC(event.ts);
    const fp = auditFilePath(d);

    const line = JSON.stringify(event) + "\n";
    await fs.appendFile(fp, line, "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

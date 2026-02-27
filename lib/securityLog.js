import crypto from "crypto";
import { readUsers, writeUsers } from "./userStore";

// ⏱️ نگه‌داری لاگ‌ها: ۳۰ روز
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// --- Simple in-process lock to avoid concurrent read/modify/write races ---
const _locks = globalThis.__regorixa_locks || (globalThis.__regorixa_locks = {});
function withLock(key, fn) {
  const prev = _locks[key] || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  _locks[key] = next;
  return next;
}

function cleanNoCrlf(v) {
  return String(v || "").replace(/[\r\n]+/g, " ").trim();
}

function normalizeIp(ip) {
  if (!ip) return "";
  let v = String(ip).trim().replace(/[\r\n\s]+/g, "");

  if (v === "::1") return "127.0.0.1";
  if (v.startsWith("::ffff:")) v = v.slice(7);

  // Allow only typical ip chars (ipv4/ipv6)
  if (!/^[0-9a-fA-F:.]+$/.test(v)) return "";
  return v;
}

function getIp(req) {
  const h = req?.headers || {};

  // 1) Cloudflare
  const cf = h["cf-connecting-ip"];
  if (typeof cf === "string") {
    const ip = normalizeIp(cf);
    if (ip) return ip;
  }

  // 2) X-Forwarded-For
  const xff = h["x-forwarded-for"];
  if (xff) {
    if (Array.isArray(xff)) {
      const ip = normalizeIp(xff[0]);
      if (ip) return ip;
    }
    if (typeof xff === "string") {
      const first = xff.split(",")[0];
      const ip = normalizeIp(first);
      if (ip) return ip;
    }
  }

  // 3) X-Real-IP
  const realIp = h["x-real-ip"];
  if (typeof realIp === "string") {
    const ip = normalizeIp(realIp);
    if (ip) return ip;
  }

  // 4) socket fallback
  const ra =
    req?.socket?.remoteAddress ||
    req?.connection?.remoteAddress ||
    "";

  const ip = normalizeIp(ra);
  return ip || "unknown";
}

function getUa(req) {
  const ua = cleanNoCrlf(req?.headers?.["user-agent"] || "unknown");
  return ua.slice(0, 300);
}

function isRecent(atIso) {
  const t = Date.parse(String(atIso || ""));
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= RETENTION_MS;
}

function safeId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function logAuthEvent({ email, req, event, ok, detail }) {
  const e = normEmail(email);
  if (!e) return;

  // lock on user email to reduce race condition on JSON store
  return withLock(`securityLog:${e}`, async () => {
    const users = await readUsers();
    const idx = users.findIndex(
      (u) => normEmail(u?.email) === e
    );
    if (idx === -1) return;

    const u = users[idx];
    if (!Array.isArray(u.securityLog)) u.securityLog = [];

    // ✅ 1) پاک‌سازی خودکار لاگ‌های قدیمی‌تر از ۳۰ روز
    u.securityLog = u.securityLog.filter((x) => isRecent(x?.at));

    // ✅ 2) افزودن لاگ جدید
    u.securityLog.unshift({
      id: safeId(),
      at: new Date().toISOString(),
      event: cleanNoCrlf(event).slice(0, 50), // "login_password" | "login_2fa"
      ok: !!ok,
      ip: getIp(req),
      ua: getUa(req),
      detail: detail ? cleanNoCrlf(detail).slice(0, 200) : "",
    });

    // ✅ 3) سقف تعداد (۲۰ آیتم)
    u.securityLog = u.securityLog.slice(0, 20);

    users[idx] = u;
    await writeUsers(users);
  });
}


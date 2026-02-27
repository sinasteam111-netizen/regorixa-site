import crypto from "crypto";
import bcrypt from "bcryptjs";
import { readUsers, writeUsers } from "../../../lib/userStore";
import { sendPasswordChangedEmail } from "../../../lib/mailer";
import { getIp, getUa } from "../../../lib/requestMeta";
import { rateLimit } from "../../../lib/rateLimit";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export default async function handler(req, res) {
  try {
    noStore(res);

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ rate limit سخت (anti-bruteforce)
    // fail-closed چون endpoint امنیتی است
    let ip = "unknown";
    try {
      ip = String(getIp(req) || "unknown");
    } catch {}

    const { email, otp, newPassword } = req.body || {};
    const e = String(email || "").trim().toLowerCase();
    const code = String(otp || "").trim();
    const pass = String(newPassword || "");

    // per IP
    try {
      const rlIp = rateLimit(`resetpw:ip:${ip}`, { windowMs: 15 * 60_000, max: 30 });
      if (!rlIp.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rlIp.resetAt });
      }
    } catch {
      return res.status(429).json({ ok: false, error: "Too many requests" });
    }

    // per email (حتی اگر خالی باشد، کلید ثابت)
    try {
      const rlEmail = rateLimit(`resetpw:email:${e || "_"}`, { windowMs: 15 * 60_000, max: 10 });
      if (!rlEmail.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rlEmail.resetAt });
      }
    } catch {
      return res.status(429).json({ ok: false, error: "Too many requests" });
    }

    if (!e || !code || !pass) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    // ✅ جلوگیری از DoS روی bcrypt (بدون تغییر پیام‌ها)
    if (pass.length > 200) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const usersRaw = await readUsers();
    const users = Array.isArray(usersRaw) ? usersRaw : [];
    const idx = users.findIndex((u) => String(u?.email || "").trim().toLowerCase() === e);

    if (idx === -1) {
      return res.status(400).json({ ok: false, error: "Invalid OTP" });
    }

    const u = users[idx];
    if (!u.resetOtpHash || !u.resetOtpExpiresAt) {
      return res.status(400).json({ ok: false, error: "No reset request" });
    }

    if (Date.now() > new Date(u.resetOtpExpiresAt).getTime()) {
      return res.status(400).json({ ok: false, error: "OTP expired" });
    }

    const incomingHash = sha256(code);

    // ✅ compare امن‌تر (بدون تغییر پیام)
    if (!timingSafeEqualStr(incomingHash, u.resetOtpHash)) {
      return res.status(400).json({ ok: false, error: "Invalid OTP" });
    }

    // ✅ تغییر پسورد
    u.passwordHash = await bcrypt.hash(pass, 12);
    u.resetOtpHash = null;
    u.resetOtpExpiresAt = null;

    // Optional audit fields (خروجی تغییر نمی‌کند)
    u.passwordChangedAt = new Date().toISOString();
    u.passwordChangedBy = "reset_otp";

    users[idx] = u;

    // ✅ writeUsers باید lock+atomic باشد (داخل userStore ایده‌آل)
    await writeUsers(users);

    // 🔐 notify user (password reset)
    try {
      const ua = getUa(req);
      await sendPasswordChangedEmail({
        to: e,
        ip,
        ua,
        atIso: new Date().toISOString(),
      });
    } catch {}

    return res.json({ ok: true });
  } catch (err) {
    console.error("reset-password error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

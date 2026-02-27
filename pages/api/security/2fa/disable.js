import speakeasy from "speakeasy";
import { readUsers, writeUsers } from "../../../../lib/userStore";
import { getSession } from "../../../../lib/auth";
import { rateLimit } from "../../../../lib/rateLimit";
import { getIp, getUa } from "../../../../lib/ipUa";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

export default async function handler(req, res) {
  try {
    noStore(res);

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ rate limit سخت (endpoint امنیتی)
    // fail-closed بهتره
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`2fa:disable:${ip}:${p}`, { windowMs: 10 * 60_000, max: 20 });
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {
      return res.status(429).json({ ok: false, error: "Too many requests" });
    }

    // ✅ امنیت واقعی: فقط خود user لاگین‌کرده
    const session = getSession(req);
    if (!session?.email) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const sessionEmail = String(session.email || "").trim().toLowerCase();

    const { token } = req.body || {};
    const t = String(token || "").trim();

    // پیام‌ها/behavior رو حفظ می‌کنیم:
    // قبلاً اگر e یا t نبود → "Missing fields"
    // الان email از session میاد، پس فقط t رو چک می‌کنیم ولی همون پیام رو برمی‌گردونیم.
    if (!sessionEmail || !t) return res.status(400).json({ ok: false, error: "Missing fields" });

    // ✅ (اختیاری) rate limit per user/email هم اضافه می‌کنیم
    try {
      const ip = getIp(req);
      const rl2 = rateLimit(`2fa:disable:user:${sessionEmail}:${ip}`, { windowMs: 10 * 60_000, max: 10 });
      if (!rl2.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl2.resetAt });
      }
    } catch {}

    const usersRaw = await readUsers();
    const users = Array.isArray(usersRaw) ? usersRaw : [];
    const idx = users.findIndex((u) => String(u?.email || "").trim().toLowerCase() === sessionEmail);
    if (idx === -1) return res.status(404).json({ ok: false, error: "User not found" });

    const u = users[idx];
    if (!u.twoFactorEnabled || !u.twoFactorSecret) {
      return res.status(400).json({ ok: false, error: "2FA is not enabled" });
    }

    const valid = speakeasy.totp.verify({
      secret: u.twoFactorSecret,
      encoding: "base32",
      token: t,
      window: 1,
    });

    if (!valid) return res.status(400).json({ ok: false, error: "Invalid code" });

    // ✅ خاموش کردن 2FA + پاکسازی کامل
    u.twoFactorEnabled = false;
    u.twoFactorSecret = null;

    // ✅ پاک کردن Backup/Recovery Codes (خیلی مهم)
    u.recoveryCodes = [];
    u.recoveryCodesCreatedAt = null;

    // Optional audit fields (خروجی تغییر نمی‌کند)
    u.twoFactorDisabledAt = new Date().toISOString();
    try {
      u.twoFactorDisabledIp = getIp(req);
      u.twoFactorDisabledUa = getUa(req);
    } catch {}

    users[idx] = u;

    // ✅ writeUsers باید lock+atomic باشد (داخل userStore ایده‌آل)
    await writeUsers(users);

    return res.json({
      ok: true,
      twoFactorEnabled: false,
      recoveryCodesRemaining: 0,
      recoveryCodesTotal: 0,
    });
  } catch (err) {
    console.error("2fa disable error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

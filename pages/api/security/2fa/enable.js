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

function cleanOtp(x) {
  // فقط عدد، حداکثر 6 رقم
  return String(x || "").replace(/\D/g, "").slice(0, 6);
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
      const rl = rateLimit(`2fa:enable:${ip}:${p}`, { windowMs: 10 * 60_000, max: 20 });
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {
      return res.status(429).json({ ok: false, error: "Too many requests" });
    }

    // ✅ امنیت واقعی: فقط user لاگین کرده خودش
    const session = getSession(req);
    if (!session?.email) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const sessionEmail = String(session.email || "").trim().toLowerCase();

    const { token } = req.body || {};
    const otp = cleanOtp(token);

    // پیام قبلی "Missing fields" را نگه می‌داریم:
    // قبلاً e یا otp مشکل داشت => Missing fields
    if (!sessionEmail || otp.length !== 6) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    // ✅ rate limit per user/email هم اضافه می‌کنیم
    try {
      const ip = getIp(req);
      const rl2 = rateLimit(`2fa:enable:user:${sessionEmail}:${ip}`, { windowMs: 10 * 60_000, max: 10 });
      if (!rl2.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl2.resetAt });
      }
    } catch {}

    const usersRaw = await readUsers();
    const users = Array.isArray(usersRaw) ? usersRaw : [];

    const idx = users.findIndex((u) => String(u?.email || "").trim().toLowerCase() === sessionEmail);

    if (idx === -1) {
      // قبلاً "User not found" با 400 بود، همون رو نگه می‌داریم
      return res.status(400).json({ ok: false, error: "User not found" });
    }

    const u = users[idx];

    if (!u.twoFactorTempSecret) {
      return res.status(400).json({ ok: false, error: "No setup in progress" });
    }

    // ✅ verify (هماهنگ با login)
    const verified = speakeasy.totp.verify({
      secret: u.twoFactorTempSecret,
      encoding: "base32",
      token: otp,
      window: 2, // ±60s
    });

    if (!verified) {
      return res.status(400).json({ ok: false, error: "Invalid code" });
    }

    // ✅ فعال‌سازی نهایی
    u.twoFactorSecret = u.twoFactorTempSecret;
    u.twoFactorTempSecret = null;
    u.twoFactorEnabled = true;

    // Optional audit fields (خروجی تغییر نمی‌کند)
    u.twoFactorEnabledAt = new Date().toISOString();
    try {
      u.twoFactorEnabledIp = getIp(req);
      u.twoFactorEnabledUa = getUa(req);
    } catch {}

    users[idx] = u;

    // ✅ writeUsers باید lock+atomic باشد (داخل userStore ایده‌آل)
    await writeUsers(users);

    return res.json({ ok: true });
  } catch (err) {
    console.error("2fa enable error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

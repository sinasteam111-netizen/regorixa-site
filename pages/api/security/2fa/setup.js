import speakeasy from "speakeasy";
import qrcode from "qrcode";
import { readUsers, writeUsers } from "../../../../lib/userStore";
import { getSession } from "../../../../lib/auth";
import { rateLimit } from "../../../../lib/rateLimit";
import { getIp, getUa } from "../../../../lib/ipUa";
import { applySecurityHeaders } from "../../../../lib/securityHeaders";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

export default async function handler(req, res) {
  try {
    // ✅ اینجا درستشه (داخل handler)
    applySecurityHeaders(res);
    noStore(res);

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false });
    }

    // ✅ rate limit سخت (setup 2FA حساس)
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`2fa:setup:${ip}:${p}`, { windowMs: 10 * 60_000, max: 20 });
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {
      return res.status(429).json({ ok: false, error: "Too many requests" });
    }

    // ✅ امنیت واقعی: فقط خود کاربر لاگین‌کرده
    const session = getSession(req);
    if (!session?.email) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const sessionEmail = String(session.email || "").trim().toLowerCase();
    if (!sessionEmail) {
      return res.status(400).json({ ok: false, error: "Missing email" });
    }

    // ✅ rate limit per user/email
    try {
      const ip = getIp(req);
      const rl2 = rateLimit(`2fa:setup:user:${sessionEmail}:${ip}`, { windowMs: 10 * 60_000, max: 10 });
      if (!rl2.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl2.resetAt });
      }
    } catch {}

    const usersRaw = await readUsers();
    const users = Array.isArray(usersRaw) ? usersRaw : [];

    const idx = users.findIndex((u) => String(u?.email || "").toLowerCase() === sessionEmail);
    if (idx === -1) {
      return res.status(400).json({ ok: false, error: "User not found" });
    }

    const secret = speakeasy.generateSecret({
      length: 20,
      name: `REGORIXA (${sessionEmail})`,
    });

    users[idx].twoFactorTempSecret = secret.base32;
    users[idx].twoFactorSetupAt = new Date().toISOString();
    try {
      users[idx].twoFactorSetupIp = getIp(req);
      users[idx].twoFactorSetupUa = getUa(req);
    } catch {}

    await writeUsers(users);

    const otpauthUrl = secret.otpauth_url;
    const qr = await qrcode.toDataURL(otpauthUrl);

    return res.json({ ok: true, qr, secret: secret.base32 });
  } catch (err) {
    console.error("2fa setup error:", err);
    return res.status(500).json({ ok: false });
  }
}
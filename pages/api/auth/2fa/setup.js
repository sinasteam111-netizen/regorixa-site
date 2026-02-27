import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { getSession } from "../../../../lib/auth";
import { findUserByEmail, updateUserByEmail } from "../../../../lib/userStore";
import { rateLimit } from "../../../../lib/rateLimit";
import { logAuthEvent } from "../../../../lib/securityLog";
import { getIp, getUa } from "../../../../lib/requestMeta";

function normEmail(x) {
  return String(x || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ must be authenticated (setup 2FA only for self)
    const session = getSession(req);
    if (!session?.email) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { email } = req.body || {};
    const sessionEmail = normEmail(session.email);
    const bodyEmail = normEmail(email);

    // ✅ اگر فرانت هنوز email می‌فرسته، باید دقیقاً با سشن یکی باشه
    if (bodyEmail && bodyEmail !== sessionEmail) {
      await logAuthEvent({
        email: sessionEmail,
        req,
        event: "2fa_setup",
        ok: false,
        detail: "email_mismatch",
      });

      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    // ✅ rate limit (per user + per ip)
    const ip = getIp(req);
    const rl1 = rateLimit(`2fa:setup:email:${sessionEmail}`, { windowMs: 10 * 60_000, max: 8 });
    const rl2 = rateLimit(`2fa:setup:ip:${ip}`, { windowMs: 10 * 60_000, max: 20 });
    if (!rl1.ok || !rl2.ok) {
      return res.status(429).json({ ok: false, error: "Too many requests. Please try again later." });
    }

    const user = await findUserByEmail(sessionEmail);
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    // ✅ اگر 2FA قبلاً فعاله، بازم می‌تونی اجازه بدی reset کنه یا نه.
    // اینجا اجازه می‌دیم setup مجدد انجام بشه ولی هنوز enabled نمی‌کنیم تا verify انجام بشه.

    const secret = speakeasy.generateSecret({
      name: `REGORIXA (${sessionEmail})`,
    });

    await updateUserByEmail(sessionEmail, {
      twoFactorSecret: secret.base32,
      twoFactorEnabled: false, // هنوز فعال نشده تا verify بشه
      twoFactorSetupAt: new Date().toISOString(),
      lastSecurityIp: ip || "unknown",
      lastSecurityUa: getUa(req),
    });

    const qr = await QRCode.toDataURL(secret.otpauth_url);

    await logAuthEvent({
      email: sessionEmail,
      req,
      event: "2fa_setup",
      ok: true,
      detail: "secret_issued",
    });

    return res.json({ ok: true, qr });
  } catch (e) {
    console.error("2fa/setup error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

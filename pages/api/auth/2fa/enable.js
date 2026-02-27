import speakeasy from "speakeasy";
import { getSession } from "../../../../lib/auth";
import { findUserByEmail, updateUserByEmail } from "../../../../lib/userStore";
import { rateLimit } from "../../../../lib/rateLimit";
import { logAuthEvent } from "../../../../lib/securityLog";
import { getIp, getUa } from "../../../../lib/requestMeta";

function normEmail(x) {
  return String(x || "").trim().toLowerCase();
}

function isStrictOtp6(t) {
  return /^\d{6}$/.test(String(t || "").trim());
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ must be authenticated (enable 2FA only for self)
    const session = getSession(req);
    if (!session?.email) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { email, token } = req.body || {};
    const sessionEmail = normEmail(session.email);
    const bodyEmail = normEmail(email);

    // ✅ اگر فرانت هنوز email می‌فرسته، باید دقیقاً با سشن یکی باشه
    if (bodyEmail && bodyEmail !== sessionEmail) {
      await logAuthEvent({
        email: sessionEmail,
        req,
        event: "2fa_enable",
        ok: false,
        detail: "email_mismatch",
      });

      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const tRaw = String(token || "").trim();
    if (!tRaw) return res.status(400).json({ ok: false, error: "Missing fields" });
    if (!isStrictOtp6(tRaw)) return res.status(400).json({ ok: false, error: "Invalid code" });

    // ✅ rate limit (per user + per ip)
    const ip = getIp(req);
    const rl1 = rateLimit(`2fa:enable:email:${sessionEmail}`, { windowMs: 5 * 60_000, max: 10 });
    const rl2 = rateLimit(`2fa:enable:ip:${ip}`, { windowMs: 5 * 60_000, max: 25 });
    if (!rl1.ok || !rl2.ok) {
      return res.status(429).json({ ok: false, error: "Too many attempts. Please try again later." });
    }

    const user = await findUserByEmail(sessionEmail);
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const secret = user.twoFactorSecret;
    if (!secret) return res.status(400).json({ ok: false, error: "2FA not setup yet" });

    const valid = speakeasy.totp.verify({
      secret,
      encoding: "base32",
      token: tRaw,
      window: 1,
    });

    if (!valid) {
      await logAuthEvent({
        email: sessionEmail,
        req,
        event: "2fa_enable",
        ok: false,
        detail: "invalid_otp",
      });

      return res.status(400).json({ ok: false, error: "Invalid code" });
    }

    // ✅ enable
    await updateUserByEmail(sessionEmail, {
      twoFactorEnabled: true,
      twoFactorEnabledAt: new Date().toISOString(),
      // ذخیره زمینه آخرین اقدام امنیتی (اختیاری ولی مفید)
      lastSecurityIp: ip || "unknown",
      lastSecurityUa: getUa(req),
    });

    await logAuthEvent({
      email: sessionEmail,
      req,
      event: "2fa_enable",
      ok: true,
      detail: "enabled",
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("2fa/enable error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

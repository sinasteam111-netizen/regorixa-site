// pages/api/security/2fa/recovery/generate.js
import speakeasy from "speakeasy";
import { getSession } from "../../../../../lib/auth";
import { findUserByEmail, updateUserByEmail } from "../../../../../lib/userStore";
import { generateRecoveryCodes, hashRecoveryCode } from "../../../../../lib/recoveryCodes";
import { rateLimit } from "../../../../../lib/rateLimit";
import { getIp, getUa } from "../../../../../lib/ipUa";

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

    // ✅ rate limit سخت (2FA حساس)
    // fail-closed بهتره چون endpoint امنیتی است
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`2fa:recovery:gen:${ip}:${p}`, { windowMs: 10 * 60_000, max: 20 }); // 20/10min/IP
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {
      return res.status(429).json({ ok: false, error: "Too many requests" });
    }

    const session = getSession(req);
    if (!session?.email) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const emailNorm = String(session.email || "").trim().toLowerCase();

    const user = await findUserByEmail(emailNorm);
    if (!user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    // ✅ اگر session.userId دارید و user.id هم دارید، mismatch => 401 (امنیت واقعی)
    if (session.userId != null && user.id != null) {
      const sid = String(session.userId);
      const uid = String(user.id);
      if (sid && uid && sid !== uid) {
        return res.status(401).json({ ok: false, error: "Not authenticated" });
      }
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ ok: false, error: "Enable 2FA first." });
    }

    const { token } = req.body || {};
    const t = String(token || "").trim();

    if (!/^\d{6}$/.test(t)) {
      return res.status(400).json({ ok: false, error: "Enter a valid 6-digit code." });
    }

    // ✅ verify TOTP
    const valid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: t,
      window: 1,
    });

    if (!valid) {
      return res.status(400).json({ ok: false, error: "Invalid authentication code." });
    }

    // ✅ generate 10 raw codes
    const rawCodes = generateRecoveryCodes(10);

    // ✅ store only hashes (one-time)
    const stored = rawCodes.map((c) => ({
      hash: hashRecoveryCode(c),
      usedAt: null,
    }));

    await updateUserByEmail(emailNorm, {
      recoveryCodes: stored,
      recoveryCodesCreatedAt: new Date().toISOString(),
      // Optional audit fields (بدون تغییر خروجی)
      recoveryCodesLastIp: (() => {
        try { return getIp(req); } catch { return undefined; }
      })(),
      recoveryCodesLastUa: (() => {
        try { return getUa(req); } catch { return undefined; }
      })(),
    });

    return res.status(200).json({ ok: true, codes: rawCodes });
  } catch (e) {
    console.error("2fa recovery generate error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

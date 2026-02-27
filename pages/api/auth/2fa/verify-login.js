import speakeasy from "speakeasy";
import { readUsers, updateUserByEmail, findUserByEmail } from "../../../../lib/userStore";
import { hashRecoveryCode, normalizeRecoveryCode } from "../../../../lib/recoveryCodes";
import { rateLimit } from "../../../../lib/rateLimit";
import { getIp } from "../../../../lib/requestMeta";

function isStrictOtp6(t) {
  return /^\d{6}$/.test(String(t || "").trim());
}

function cleanStr(v, max = 300) {
  return String(v || "").trim().slice(0, max);
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const ip = getIp(req);

    // Rate limit: this endpoint is brute-force sensitive
    const rlIp = rateLimit(`2fa:check:ip:${ip}`, { windowMs: 10 * 60_000, max: 60 });
    if (!rlIp.ok) {
      return res.status(429).json({ ok: false, error: "Too many attempts. Try again later.", resetAt: rlIp.resetAt });
    }

    const { email, token } = req.body || {};
    const e = cleanStr(email, 200).toLowerCase();
    const tRaw = cleanStr(token, 200);

    if (!e || !tRaw) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const rlEmail = rateLimit(`2fa:check:email:${e}`, { windowMs: 10 * 60_000, max: 30 });
    if (!rlEmail.ok) {
      return res.status(429).json({ ok: false, error: "Too many attempts. Try again later.", resetAt: rlEmail.resetAt });
    }

    // DB-ready lookup first
    let u = await findUserByEmail(e);

    // Fallback to legacy readUsers (kept, not removed)
    if (!u) {
      const users = await readUsers();
      u = users.find((x) => String(x?.email || "").trim().toLowerCase() === e) || null;
    }

    // Keep response generic-ish
    if (!u) return res.status(400).json({ ok: false, error: "Invalid credentials" });

    // If 2FA disabled, ok
    if (!u.twoFactorEnabled) return res.json({ ok: true });

    if (!u.twoFactorSecret) {
      return res.status(400).json({ ok: false, error: "2FA not configured" });
    }

    // --- 1) OTP ---
    if (isStrictOtp6(tRaw)) {
      const valid = speakeasy.totp.verify({
        secret: u.twoFactorSecret,
        encoding: "base32",
        token: tRaw,
        window: 1,
      });

      if (!valid) return res.status(400).json({ ok: false, error: "Invalid code" });
      return res.json({ ok: true, method: "otp" });
    }

    // --- 2) Recovery Code ---
    const normalized = normalizeRecoveryCode(tRaw); // e.g. "0D175211"
    // Your generated recovery codes are effectively 8 hex chars (A1B2C3D4) => normalized length 8
    if (normalized.length < 8) {
      return res.status(400).json({ ok: false, error: "Invalid code" });
    }

    const h = hashRecoveryCode(normalized);
    const codes = Array.isArray(u.recoveryCodes) ? u.recoveryCodes : [];
    const idx = codes.findIndex((c) => c?.hash === h && !c?.usedAt);

    if (idx === -1) {
      return res.status(400).json({ ok: false, error: "Invalid code" });
    }

    // مصرف کد (one-time)
    const updatedCodes = [...codes];
    updatedCodes[idx] = { ...updatedCodes[idx], usedAt: new Date().toISOString() };

    await updateUserByEmail(u.email, { recoveryCodes: updatedCodes });

    return res.json({ ok: true, method: "recovery" });
  } catch (e) {
    console.error("2fa check error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

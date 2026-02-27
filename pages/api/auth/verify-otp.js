// pages/api/auth/verify-otp.js
import crypto from "crypto";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp, getUa } from "../../../lib/ipUa";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function base64urlDecode(input) {
  const pad = 4 - (input.length % 4 || 4);
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b64, "base64").toString("utf8");
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function verifyToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  if (!timingSafeEqualStr(sigB64, expectedSig)) return null;

  try {
    const payloadJson = base64urlDecode(payloadB64);
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

// ===== In-memory stores (DEV only; DB-ready replacement point) =====
const OTP_KEY = "__REGORIXA_OTP_STORE__";
const VERIFIED_KEY = "__REGORIXA_EMAIL_VERIFIED__";

function getStores() {
  if (!globalThis[OTP_KEY]) globalThis[OTP_KEY] = new Map(); // jti -> { email, codeHash, expiresAt, createdAt, ip, ua }
  if (!globalThis[VERIFIED_KEY]) globalThis[VERIFIED_KEY] = new Map(); // email -> verifiedUntil
  return { otpStore: globalThis[OTP_KEY], verifiedStore: globalThis[VERIFIED_KEY] };
}

function now() {
  return Date.now();
}

function cleanupOtpStore(otpStore) {
  const t = now();
  for (const [jti, entry] of otpStore.entries()) {
    if (!entry?.expiresAt || t > entry.expiresAt + 60_000) {
      otpStore.delete(jti);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default async function handler(req, res) {
  try {
    noStore(res);

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const secret = process.env.OTP_SECRET;
    if (!secret) {
      return res.status(500).json({ ok: false, error: "Server missing OTP_SECRET" });
    }

    const { otpStore, verifiedStore } = getStores();
    cleanupOtpStore(otpStore);

    const { token, code } = req.body || {};
    const codeNorm = String(code || "").trim();

    if (!token || !/^\d{6}$/.test(codeNorm)) {
      return res.status(400).json({ ok: false, error: "Invalid token/code" });
    }

    const ip = getIp(req);
    const ua = getUa(req); // فقط برای audit آینده (خروجی تغییر نمی‌کنه)
    const p = String(req?.url || "").split("?")[0] || "";

    // ✅ rate limit سخت روی IP (anti brute force)
    // fail-closed چون امنیتی است
    try {
      const rlIp = rateLimit(`verifyotp:ip:${ip}:${p}`, { windowMs: 15 * 60_000, max: 30 });
      if (!rlIp.ok) {
        return res.status(429).json({ ok: false, error: "Too many attempts", resetAt: rlIp.resetAt });
      }
    } catch {
      return res.status(429).json({ ok: false, error: "Too many attempts" });
    }

    // کندکننده برای brute force (همان منطق قبلی)
    await sleep(350);

    const payload = verifyToken(token, secret);
    if (!payload?.jti || !payload?.email || !payload?.exp) {
      return res.status(400).json({ ok: false, error: "Invalid token" });
    }

    const emailNorm = String(payload.email).toLowerCase();
    const jti = String(payload.jti);

    // ✅ rate limit per email (ضد حمله روی یک ایمیل)
    try {
      const rlEmail = rateLimit(`verifyotp:email:${emailNorm}:${p}`, { windowMs: 10 * 60_000, max: 10 });
      if (!rlEmail.ok) {
        return res.status(429).json({ ok: false, error: "Too many attempts", resetAt: rlEmail.resetAt });
      }
    } catch {
      return res.status(429).json({ ok: false, error: "Too many attempts" });
    }

    if (now() > Number(payload.exp)) {
      otpStore.delete(jti);
      return res.status(400).json({ ok: false, error: "Code expired" });
    }

    const entry = otpStore.get(jti);
    if (!entry || entry.email !== emailNorm) {
      return res.status(400).json({ ok: false, error: "Invalid token/code" });
    }

    // ✅ rate limit per jti (همان ایده قبلی، یکدست شده با lib)
    try {
      const rlJti = rateLimit(`verifyotp:jti:${jti}:${p}`, { windowMs: 10 * 60_000, max: 5 });
      if (!rlJti.ok) {
        return res.status(429).json({ ok: false, error: "Too many attempts", resetAt: rlJti.resetAt });
      }
    } catch {
      return res.status(429).json({ ok: false, error: "Too many attempts" });
    }

    // ✅ compare امن
    if (!timingSafeEqualStr(sha256Hex(codeNorm), entry.codeHash)) {
      return res.status(400).json({ ok: false, error: "Invalid token/code" });
    }

    // ✅ success: one-time use
    otpStore.delete(jti);

    // 🔐 ایمیل رو 30 دقیقه verified نگه می‌داریم
    verifiedStore.set(emailNorm, now() + 30 * 60_000);

    return res.status(200).json({
      ok: true,
      email: emailNorm,
      emailVerified: true,
    });
  } catch (e) {
    console.error("verify-otp error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

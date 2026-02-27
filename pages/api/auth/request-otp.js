// pages/api/auth/request-otp.js
import crypto from "crypto";
import { getPublicBaseUrl } from "../../../lib/baseUrl";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp, getUa } from "../../../lib/ipUa";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function base64urlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
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

function signToken(payloadObj, secret) {
  const payloadJson = JSON.stringify(payloadObj);
  const payloadB64 = base64urlEncode(payloadJson);
  const sigB64 = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${payloadB64}.${sigB64}`;
}

// (در این فایل فعلاً verifyToken استفاده نشده؛ حذفش نمی‌کنم چون گفتی حذف نکن)
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

function isEmail(s) {
  const v = String(s || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// ====== In-memory store wrapper (DB-ready replacement point) ======
const GLOBAL_KEY = "__REGORIXA_OTP_STORE__";

function getOtpStore() {
  if (!globalThis[GLOBAL_KEY]) globalThis[GLOBAL_KEY] = new Map(); // jti -> { email, codeHash, expiresAt, createdAt }
  return globalThis[GLOBAL_KEY];
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

// ✅ ارسال ایمیل با Resend + لاگ کامل خطا
async function sendEmailResend({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey) throw new Error("Missing RESEND_API_KEY in .env.local");
  if (!from) throw new Error("Missing EMAIL_FROM in .env.local (e.g. REGORIXA <noreply@regorixa.com>)");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("RESEND ERROR STATUS:", res.status);
    console.error("RESEND ERROR BODY:", text);
    throw new Error(`Resend error: ${res.status} ${text}`);
  }
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

    const otpStore = getOtpStore();
    cleanupOtpStore(otpStore);

    const { email } = req.body || {};
    const emailNorm = String(email || "").trim().toLowerCase();

    if (!emailNorm) return res.status(400).json({ ok: false, error: "Missing email" });
    if (!isEmail(emailNorm)) return res.status(400).json({ ok: false, error: "Invalid email" });

    const ip = getIp(req);
    const ua = getUa(req); // فقط برای audit آینده (فعلاً رفتار خروجی تغییر نمی‌کنه)
    const p = String(req?.url || "").split("?")[0] || "";

    // ✅ Rate limit یکدست با پروژه (به جای rateLimit داخلی فایل)
    // per IP
    const rlIp = rateLimit(`reqotp:ip:${ip}:${p}`, { windowMs: 15 * 60_000, max: 10 });
    if (!rlIp.ok) {
      return res.status(429).json({ ok: false, error: "Too many requests. Try later." });
    }

    // per email
    const rlEmail = rateLimit(`reqotp:email:${emailNorm}:${p}`, { windowMs: 15 * 60_000, max: 3 });
    if (!rlEmail.ok) {
      return res.status(429).json({ ok: false, error: "Too many requests. Try later." });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const expiresInSeconds = 5 * 60;
    const expiresAt = now() + expiresInSeconds * 1000;

    const jti = crypto.randomBytes(16).toString("hex");
    otpStore.set(jti, {
      email: emailNorm,
      codeHash: sha256Hex(code),
      expiresAt,
      createdAt: now(),
      // ua/ip رو می‌تونیم نگه داریم برای امنیت (بدون تغییر خروجی)
      ip,
      ua,
    });

    const token = signToken({ v: 2, jti, email: emailNorm, exp: expiresAt }, secret);

    const subject = "REGORIXA Email Verification Code";

    const baseUrl = getPublicBaseUrl(req);
    const loginUrl = `${baseUrl}/login`;
    const securityUrl = `${baseUrl}/security`;

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6">
        <h2>Verify your email</h2>
        <p>Your verification code is:</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">${code}</div>
        <p>This code expires in <b>${Math.floor(expiresInSeconds / 60)} minutes</b>.</p>
        <p>If you did not request this, ignore this email.</p>
        <div style="margin-top:14px">
          <a href="${loginUrl}" style="color:#0b57d0;text-decoration:none">Go to Login</a>
          <span style="color:#aaa"> • </span>
          <a href="${securityUrl}" style="color:#0b57d0;text-decoration:none">Security</a>
        </div>
      </div>
    `;

    await sendEmailResend({ to: emailNorm, subject, html });

    // ✅ خروجی همون قبلی، بدون تغییر
    return res.status(200).json({ ok: true, token, expiresAt });
  } catch (e) {
    console.error("request-otp error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

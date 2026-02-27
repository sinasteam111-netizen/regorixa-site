// pages/api/auth/register.js
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { addUser, findUserByEmail } from "../../../lib/userStore";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp, getUa } from "../../../lib/ipUa";

const VERIFIED_KEY = "__REGORIXA_EMAIL_VERIFIED__";

function getVerifiedStore() {
  if (!globalThis[VERIFIED_KEY]) globalThis[VERIFIED_KEY] = new Map();
  return globalThis[VERIFIED_KEY];
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function isEmail(s) {
  const v = String(s || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function safeId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

function cleanStr(v, max = 120) {
  return String(v || "").trim().slice(0, max);
}

function cleanPhone(v) {
  const s = String(v || "").trim().slice(0, 30);
  return s.replace(/[^\d+\-()\s]/g, "");
}

function cleanBirthDate(v) {
  return String(v || "").trim().slice(0, 20);
}

// -------------------- password policy --------------------
const PASS_MIN = 8;
const PASS_MAX = 72;

function validatePassword(pw) {
  const p = String(pw ?? "");

  const reasons = [];
  if (p.length < PASS_MIN) reasons.push(`at least ${PASS_MIN} characters`);
  if (p.length > PASS_MAX) reasons.push(`at most ${PASS_MAX} characters`);
  if (!/[a-z]/.test(p)) reasons.push("a lowercase letter (a-z)");
  if (!/[A-Z]/.test(p)) reasons.push("an uppercase letter (A-Z)");
  if (!/\d/.test(p)) reasons.push("a number (0-9)");
  if (!/[^A-Za-z0-9]/.test(p)) reasons.push("a symbol (!@#$...)");

  return { ok: reasons.length === 0, reasons };
}

function passwordError(reasons) {
  return `Weak password. Please use ${reasons.join(", ")}.`;
}
export default async function handler(req, res) {
  try {
    noStore(res);

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const ip = getIp(req);
    const ua = getUa(req);

    // Rate-limit: per IP
    let rlIp;
    try {
      rlIp = rateLimit(`register:ip:${ip}`, { windowMs: 10 * 60 * 1000, max: 20 });
    } catch {
      return res.status(429).json({ ok: false, error: "Too many requests" });
    }
    if (!rlIp.ok) {
      return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rlIp.resetAt });
    }

    const { firstName, lastName, birthDate, phone, email, password } = req.body || {};
    const emailNorm = String(email || "").trim().toLowerCase();

    // ✅ اول validate پایه رو انجام بده، بعد rate limit per-email
    if (!firstName || !lastName || !birthDate || !phone || !emailNorm || !password) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    if (!isEmail(emailNorm)) {
      return res.status(400).json({ ok: false, error: "Invalid email" });
    }

    // Rate-limit: per email (بعد از اینکه مطمئن شدیم ایمیل معتبره)
    let rlEmail;
    try {
      rlEmail = rateLimit(`register:email:${emailNorm}`, {
        windowMs: 10 * 60 * 1000,
        max: 5,
      });
    } catch {
      return res.status(429).json({ ok: false, error: "Too many requests" });
    }
    if (!rlEmail.ok) {
      return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rlEmail.resetAt });
    }

    // ✅ Password rules (server-side enforce)
    const pw = String(password);
    const check = validatePassword(pw);
    if (!check.ok) {
      return res.status(400).json({
        ok: false,
        error: passwordError(check.reasons),
        code: "WEAK_PASSWORD",
        rules: check.reasons,
      });
    }
    // ✅ must be verified via OTP
    const verifiedStore = getVerifiedStore();
    const verifiedUntil = verifiedStore.get(emailNorm);

    const untilNum = Number(verifiedUntil);
    if (!untilNum || Number.isNaN(untilNum) || Date.now() > untilNum) {
      return res.status(403).json({ ok: false, error: "Email not verified" });
    }

    const exists = await findUserByEmail(emailNorm);
    if (exists) return res.status(409).json({ ok: false, error: "Account already exists" });

    const passwordHash = await bcrypt.hash(pw, 12);

    const user = {
      id: safeId(),
      firstName: cleanStr(firstName, 60),
      lastName: cleanStr(lastName, 60),
      birthDate: cleanBirthDate(birthDate),
      phone: cleanPhone(phone),
      email: emailNorm,
      passwordHash,
      createdAt: new Date().toISOString(),
      emailVerified: true,
      role: "user",
      lastRegisterIp: ip,
      lastRegisterUa: ua,
    };

    await addUser(user);

    verifiedStore.delete(emailNorm);

    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        emailVerified: true,
      },
    });
  } catch (e) {
    console.error("register error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

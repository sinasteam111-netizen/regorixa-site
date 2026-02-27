import bcrypt from "bcryptjs";
import { findUserByEmail, updateUserByEmail } from "../../../lib/userStore";
import { createPending2fa } from "../../../lib/pending2fa";
import { logAuthEvent } from "../../../lib/securityLog";
import { sendLoginAlertEmail } from "../../../lib/mailer";
import { getIp, getUa } from "../../../lib/requestMeta";
import { rateLimit } from "../../../lib/rateLimit";
import { createSessionCookieValue, COOKIE_NAME } from "../../../lib/auth";
import { createSetCookieHeader } from "../../../lib/auth";
import { verifyCsrf, rejectCsrf } from "../../../lib/csrf";
import { applySecurityHeaders } from "../../../lib/securityHeaders";
import { appendSetCookie } from "../../../lib/cookieUtils";

function issueSession(res, user) {
  const sessionTtlMs = 7 * 24 * 60 * 60_000;

  const session = {
    userId: user.id,
    email: user.email,
    role: user.role,
    expiresAt: Date.now() + sessionTtlMs,
  };

  const value = createSessionCookieValue(session);
  const maxAgeSec = Math.floor(sessionTtlMs / 1000);

  // ✅ استفاده از serializer استاندارد خودت
  // ✅ append (نه overwrite) برای Set-Cookie
  appendSetCookie(
    res,
    createSetCookieHeader(value, {
      maxAge: maxAgeSec,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
      // domain: undefined  (فعلاً نذار، مگر اینکه دقیقاً بدونی چی می‌خوای)
    })
  );
}

function clearOldSessionCookie(res) {
  // session rotation hardening: clear previous cookie (best-effort)
  // (بدون تغییر خروجی API، فقط رفتار cookie بهتر می‌شه)
  try {
    appendSetCookie(
      res,
      `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${
        process.env.NODE_ENV === "production" ? "; Secure" : ""
      }`
    );
  } catch {}
}

function normalizeUa(ua) {
  return String(ua || "").trim().replace(/\s+/g, " ").slice(0, 300);
}

function isNewLoginContext(prevIp, prevUa, ip, ua) {
  const a = String(prevIp || "");
  const b = String(ip || "");
  const uaA = normalizeUa(prevUa);
  const uaB = normalizeUa(ua);
  return !a || a !== b || !uaA || uaA !== uaB;
}

function isEmail(s) {
  const v = String(s || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");
    applySecurityHeaders(res);

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ CSRF (اختیاری برای login)
    // اگر CSRF token داری و فرستادی، validate می‌کنیم؛
    // اگر نداری، login رو نمی‌شکنیم (برای سازگاری).
    // اگر می‌خوای سخت‌گیرانه‌اش کنیم، همینجا مستقیم rejectCsrf کن.
    try {
      const hasCsrfHeader = !!(req.headers["x-csrf-token"] || req.headers["x-csrf-token".toLowerCase()]);
      if (hasCsrfHeader && !verifyCsrf(req)) return rejectCsrf(res);
    } catch {}

    // Use your centralized meta helpers (less spoofable / consistent)
    const ip = getIp(req);
    const ua = getUa(req);

    // Rate limit by IP (broad protection)
    const rlIp = rateLimit(`login:ip:${ip}`, {
      windowMs: 15 * 60_000,
      max: 10, // 10 tries / 15 min
    });

    if (!rlIp.ok) {
      return res.status(429).json({
        ok: false,
        error: "Too many login attempts. Please try again later.",
        resetAt: rlIp.resetAt,
      });
    }

    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      return res.status(500).json({ ok: false, error: "Missing SESSION_SECRET" });
    }

    const { email, password } = req.body || {};
    const emailNorm = String(email || "").trim().toLowerCase();

    if (!emailNorm || !password) {
      return res.status(400).json({ ok: false, error: "Missing email/password" });
    }

    if (!isEmail(emailNorm)) {
      // keep message generic-ish
      return res.status(401).json({ ok: false, error: "Invalid email or password" });
    }

    const pw = String(password);

    // avoid bcrypt DoS with extremely long passwords
    if (pw.length > 200) {
      return res.status(400).json({ ok: false, error: "Password too long" });
    }

    // Rate limit by email too (targeted protection)
    const rlEmail = rateLimit(`login:email:${emailNorm}`, {
      windowMs: 15 * 60_000,
      max: 10,
    });

    if (!rlEmail.ok) {
      return res.status(429).json({
        ok: false,
        error: "Too many login attempts. Please try again later.",
        resetAt: rlEmail.resetAt,
      });
    }

    const user = await findUserByEmail(emailNorm);

    // ❌ user not found
    if (!user) {
      await logAuthEvent({
        email: emailNorm,
        req,
        event: "login_password",
        ok: false,
        detail: "invalid_credentials",
      });

      // keep response generic (anti-enumeration)
      return res.status(401).json({ ok: false, error: "Invalid email or password" });
    }

    const passOk = await bcrypt.compare(pw, user.passwordHash);

    // ❌ wrong password
    if (!passOk) {
      await logAuthEvent({
        email: emailNorm,
        req,
        event: "login_password",
        ok: false,
        detail: "invalid_credentials",
      });

      return res.status(401).json({ ok: false, error: "Invalid email or password" });
    }

    // ✅ password ok, but 2FA enabled → step 2 required (no session yet)
    if (user.twoFactorEnabled) {
      // ✅ اگر 2FA روشنه ولی secret نداره، ورود رو نگه نداریم
      if (!user.twoFactorSecret) {
        await logAuthEvent({
          email: user.email,
          req,
          event: "login_password",
          ok: false,
          detail: "2fa_enabled_but_missing_secret",
        });
        return res.status(400).json({
          ok: false,
          error: "2FA is enabled but not configured correctly. Please disable and re-enable 2FA.",
        });
      }

      // ✅ اینجا لاگ OK نمی‌زنیم تا duplicate ساخته نشه
      const pending2faToken = createPending2fa(user.email, 5 * 60 * 1000);

      return res.status(200).json({
        ok: true,
        twoFactorRequired: true,
        pending2faToken,
      });
    }

    // ✅ session rotation hardening: clear old cookie first (best-effort)
    clearOldSessionCookie(res);

    // ✅ normal login (no 2FA)
    issueSession(res, user);

    const nowIso = new Date().toISOString();

    const prevIp = user.lastLoginIp || "";
    const prevUa = user.lastLoginUa || "";
    const hadLogs = Array.isArray(user.securityLog) && user.securityLog.length > 0;

    // ✅ اگر لاگ‌ها خالی باشه (بعد از cleanup)، اولین لاگین هم لاگ ثبت می‌کنه
    const isNew = !hadLogs || isNewLoginContext(prevIp, prevUa, ip, ua);

    // ✅ فقط اگر جدید بود، لاگ موفق بساز
    if (isNew) {
      await logAuthEvent({
        email: user.email,
        req,
        event: "login_password",
        ok: true,
        detail: "session_issued",
      });
    }

    // ✅ همیشه آخرین IP/UA/At رو ذخیره کن
    await updateUserByEmail(user.email, {
      lastLoginIp: ip,
      lastLoginUa: String(ua || ""),
      lastLoginAt: nowIso,
    });

    // ✅ ایمیل هم فقط وقتی جدید بود
    if (isNew) {
      sendLoginAlertEmail({ to: user.email, ip, ua, atIso: nowIso }).catch((e) =>
        console.error("login alert email error:", e)
      );
    }

    return res.status(200).json({
      ok: true,
      user: { email: user.email, role: user.role },
    });
  } catch (e) {
    console.error("login error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

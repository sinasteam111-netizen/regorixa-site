import speakeasy from "speakeasy";
import crypto from "crypto";
import { findUserByEmail, updateUserByEmail } from "../../../../lib/userStore";
import { peekPending2fa, consumePending2fa } from "../../../../lib/pending2fa";
import { logAuthEvent } from "../../../../lib/securityLog";
import { sendLoginAlertEmail } from "../../../../lib/mailer";
import { getIp, getUa } from "../../../../lib/requestMeta";
import { hashRecoveryCode, normalizeRecoveryCode } from "../../../../lib/recoveryCodes";
import { rateLimit } from "../../../../lib/rateLimit";
import { createSessionCookieValue, COOKIE_NAME, createSetCookieHeader } from "../../../../lib/auth";
import { verifyCsrf, rejectCsrf } from "../../../../lib/csrf";
import { applySecurityHeaders } from "../../../../lib/securityHeaders";
import { appendSetCookie } from "../../../../lib/cookieUtils";

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

  // ✅ یکدست با login.js + overwrite-safe
  appendSetCookie(
    res,
    createSetCookieHeader(value, {
      maxAge: maxAgeSec,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
    })
  );
}

function clearOldSessionCookie(res) {
  // session rotation hardening: clear previous cookie (best-effort)
  try {
    appendSetCookie(
      res,
      `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${
        process.env.NODE_ENV === "production" ? "; Secure" : ""
      }`
    );
  } catch {}
}

function isStrictOtp6(t) {
  return /^\d{6}$/.test(String(t || "").trim());
}

function cleanOtp(x) {
  return String(x || "").replace(/\D/g, "").slice(0, 6);
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

function safeId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");
    applySecurityHeaders(res);

    // ✅ CSRF (این endpoint حساسه و cookie صادر می‌کنه)
    if (!verifyCsrf(req)) return rejectCsrf(res);

    // ✅ content-type hardening
    const ct = String(req.headers["content-type"] || "");
    if (ct && !ct.includes("application/json")) {
      return res.status(415).json({ ok: false, error: "Unsupported Media Type" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      return res.status(500).json({ ok: false, error: "Missing SESSION_SECRET" });
    }

    const ip = getIp(req);
    const ua = getUa(req);

    // Rate limit verify step (stronger than login, because OTP brute force is common)
    const rlIp = rateLimit(`2fa:verify:ip:${ip}`, { windowMs: 10 * 60_000, max: 20 });
    if (!rlIp.ok) {
      return res.status(429).json({
        ok: false,
        error: "Too many attempts. Try again later.",
        resetAt: rlIp.resetAt,
      });
    }

    const { pending2faToken, token } = req.body || {};
    const p = String(pending2faToken || "").trim();
    const tRaw = String(token || "").trim();

    // Keep your debug logs, but only outside production
    if (process.env.NODE_ENV !== "production") {
      console.log("2FA REQ", {
        hasPending: !!p,
        tokenLen: String(tRaw || "").length,
      });
    }

    if (!p || !tRaw) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const email = peekPending2fa(p);

    if (process.env.NODE_ENV !== "production") {
      console.log("2FA PENDING", {
        token: p.slice(0, 8) + "...",
        email: email || null,
      });
    }

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "2FA session expired. Please login again.",
      });
    }

    // Rate limit per email too
    const rlEmail = rateLimit(`2fa:verify:email:${email}`, { windowMs: 10 * 60_000, max: 20 });
    if (!rlEmail.ok) {
      return res.status(429).json({
        ok: false,
        error: "Too many attempts. Try again later.",
        resetAt: rlEmail.resetAt,
      });
    }

    // DB-ready lookup
    const user = await findUserByEmail(email);

    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      await logAuthEvent({
        email,
        req,
        event: "login_2fa",
        ok: false,
        detail: "invalid_user_or_2fa_disabled",
      });
      return res.status(400).json({ ok: false, error: "Invalid user" });
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("2FA DEBUG", {
        email: user.email,
        twoFactorEnabled: user.twoFactorEnabled,
        hasSecret: !!user.twoFactorSecret,
        tokenLen: tRaw.length,
        tokenLooksOtp: isStrictOtp6(tRaw),
      });
    }

    let method = "otp";
    let recoveryCodesTotal = 0;
    let recoveryCodesRemaining = 0;

    if (isStrictOtp6(tRaw)) {
      const otp = cleanOtp(tRaw);

      if (process.env.NODE_ENV !== "production") {
        console.log("2FA USER", {
          email: user.email,
          enabled: !!user.twoFactorEnabled,
          hasSecret: !!user.twoFactorSecret,
          secretLen: String(user.twoFactorSecret || "").length,
        });
      }

      const validOtp = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: otp,
        window: 2,
      });

      if (!validOtp) {
        await logAuthEvent({
          email: user.email,
          req,
          event: "login_2fa",
          ok: false,
          detail: "invalid_2fa_code",
        });

        return res.status(400).json({ ok: false, error: "Invalid authentication code" });
      }

      method = "otp";
    } else {
      const normalized = normalizeRecoveryCode(tRaw);
      if (normalized.length < 8) {
        await logAuthEvent({
          email: user.email,
          req,
          event: "login_2fa",
          ok: false,
          detail: "invalid_recovery_format",
        });
        return res.status(400).json({ ok: false, error: "Invalid authentication code" });
      }

      const h = hashRecoveryCode(normalized);
      const codes = Array.isArray(user.recoveryCodes) ? user.recoveryCodes : [];
      const idx = codes.findIndex((c) => c?.hash === h && !c?.usedAt);

      if (idx === -1) {
        await logAuthEvent({
          email: user.email,
          req,
          event: "login_2fa",
          ok: false,
          detail: "invalid_or_used_recovery_code",
        });
        return res.status(400).json({ ok: false, error: "Invalid authentication code" });
      }

      const updatedCodes = [...codes];
      updatedCodes[idx] = { ...updatedCodes[idx], usedAt: new Date().toISOString() };
      await updateUserByEmail(user.email, { recoveryCodes: updatedCodes });

      method = "recovery";
      recoveryCodesTotal = updatedCodes.length;
      recoveryCodesRemaining = updatedCodes.filter((c) => c && !c.usedAt).length;
    }

    // IMPORTANT: consume pending token (one-time). Await it.
    const consumed = await consumePending2fa(p);
    if (!consumed) {
      // If token already used / replayed
      await logAuthEvent({
        email: user.email,
        req,
        event: "login_2fa",
        ok: false,
        detail: "pending2fa_replay_or_invalid",
      });
      return res.status(400).json({
        ok: false,
        error: "2FA session expired. Please login again.",
      });
    }

    // ✅ session rotation hardening
    clearOldSessionCookie(res);

    // Issue normal session cookie (same as login.js)
    issueSession(res, user);

    const nowIso = new Date().toISOString();

    const prevIp = user.lastLoginIp || "";
    const prevUa = user.lastLoginUa || "";
    const hadLogs = Array.isArray(user.securityLog) && user.securityLog.length > 0;

    // ✅ اگر لاگ‌ها خالی باشه (بعد از cleanup)، اولین لاگین هم لاگ ثبت می‌کنه
    const isNew = !hadLogs || isNewLoginContext(prevIp, prevUa, ip, ua);

    if (isNew) {
      await logAuthEvent({
        email: user.email,
        req,
        event: "login_2fa",
        ok: true,
        detail: method === "recovery" ? "session_issued_recovery" : "session_issued",
      });
    }

    await updateUserByEmail(user.email, {
      lastLoginIp: ip,
      lastLoginUa: String(ua || ""),
      lastLoginAt: nowIso,
    });

    if (isNew) {
      sendLoginAlertEmail({ to: user.email, ip, ua, atIso: nowIso }).catch((e) =>
        console.error("login alert email error:", e)
      );
    }

    return res.json({
      ok: true,
      method,
      recoveryCodesTotal,
      recoveryCodesRemaining,
      // Optional: keep existing behavior; no user object returned here previously
      requestId: safeId(),
    });
  } catch (err) {
    console.error("2fa complete-login error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

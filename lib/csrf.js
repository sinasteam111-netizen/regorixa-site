// lib/csrf.js
import crypto from "crypto";

const CSRF_COOKIE = "regorixa_csrf";
const CSRF_HEADER = "x-csrf-token";

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function safeEq(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function readCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = String(cookieHeader)
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);

  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    const k = p.slice(0, eq).trim();
    if (k !== name) continue;
    return p.slice(eq + 1);
  }
  return null;
}

export function issueCsrfToken(options = {}) {
  const {
    maxAge = 60 * 60 * 12,
    path = "/",
    sameSite = "Lax",
    secure = process.env.NODE_ENV === "production",
    domain,
  } = options;

  const token = base64url(crypto.randomBytes(32));

  const parts = [`${CSRF_COOKIE}=${encodeURIComponent(token)}`];
  parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (path) parts.push(`Path=${path}`);
  if (domain) parts.push(`Domain=${domain}`);
  if (secure) parts.push("Secure");
  if (sameSite) parts.push(`SameSite=${sameSite}`);

  return { token, setCookie: parts.join("; ") };
}

export function verifyCsrf(req) {
  const method = (req?.method || "GET").toUpperCase();
  const needs = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (!needs) return true;

  const cookieHeader = req?.headers?.cookie || "";
  const csrfCookie = readCookieValue(cookieHeader, CSRF_COOKIE);
  if (!csrfCookie) return false;

  const csrfHeader =
    req?.headers?.[CSRF_HEADER] ||
    req?.headers?.[CSRF_HEADER.toLowerCase()] ||
    null;

  if (!csrfHeader) return false;

  const cookieVal = decodeURIComponent(csrfCookie);
  return safeEq(cookieVal, String(csrfHeader));
}

export function rejectCsrf(res) {
  res.status(403).json({ ok: false, error: "CSRF_FAILED" });
}

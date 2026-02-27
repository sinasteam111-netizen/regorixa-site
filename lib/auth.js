// lib/auth.js
import crypto from "crypto";

const COOKIE_NAME = "regorixa_session";

/**
 * Optional encryption key (recommended for confidentiality):
 * - Provide SESSION_ENC_KEY as:
 *   - 32-byte hex (64 chars) OR
 *   - base64 of 32 bytes
 *
 * If not provided, payload will remain signed-only (backward compatible).
 */
function getEncKey() {
  const k = process.env.SESSION_ENC_KEY;
  if (!k) return null;

  // hex 64 chars => 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, "hex");

  // base64 => 32 bytes (common)
  try {
    const b = Buffer.from(k, "base64");
    if (b.length === 32) return b;
  } catch {
    // ignore
  }

  // If key is malformed, treat as not set (safer than throwing on runtime reads)
  return null;
}

function base64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecodeToBuffer(input) {
  const s = String(input);
  const pad = 4 - (s.length % 4 || 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b64, "base64");
}

function base64urlDecode(input) {
  return base64urlDecodeToBuffer(input).toString("utf8");
}

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function sign(payloadB64, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * NEW: Support HMAC key rotation without breaking existing sessions.
 * - Primary key: SESSION_SECRET
 * - Optional old key: SESSION_SECRET_OLD
 *
 * Verification accepts any; issuing uses primary.
 */
function getHmacKeys() {
  const primary = process.env.SESSION_SECRET || null;
  const old = process.env.SESSION_SECRET_OLD || null;

  const keys = [];
  if (primary) keys.push(primary);
  if (old && old !== primary) keys.push(old);

  return { primary, keys };
}

/**
 * Encrypt plaintext (utf8 string) using AES-256-GCM.
 * Returns a compact string that can be placed inside cookie payload:
 *   "e1.<ivB64u>.<ctB64u>.<tagB64u>"
 */
function encryptIfPossible(plaintext) {
  const key = getEncKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(12); // recommended size for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `e1.${base64urlEncode(iv)}.${base64urlEncode(ct)}.${base64urlEncode(tag)}`;
}

function decryptIfNeeded(maybeEncrypted) {
  const key = getEncKey();
  const s = String(maybeEncrypted);

  // If no key, we cannot decrypt; treat as plain JSON (backward compatible)
  if (!key) return s;

  // Only decrypt if it matches our envelope
  if (!s.startsWith("e1.")) return s;

  const parts = s.split(".");
  // e1.<iv>.<ct>.<tag> => length 4
  if (parts.length !== 4) return null;

  const [, ivB64u, ctB64u, tagB64u] = parts;
  try {
    const iv = base64urlDecodeToBuffer(ivB64u);
    const ct = base64urlDecodeToBuffer(ctB64u);
    const tag = base64urlDecodeToBuffer(tagB64u);

    if (iv.length !== 12) return null;

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Safer cookie parser (handles multiple cookies reliably)
 */
function readCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;

  // Split on ; and trim
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

/**
 * Minimal session validation to avoid weird objects.
 * (Does NOT remove your existing fields; just sanity-checks them.)
 */
function validateSessionShape(session) {
  if (!session || typeof session !== "object") return false;

  // Keep your existing behavior: require email
  if (!session.email || typeof session.email !== "string") return false;

  // Optional: userId can be string/number
  if (session.userId != null && !["string", "number"].includes(typeof session.userId)) return false;

  // Optional: role should be string if present
  if (session.role != null && typeof session.role !== "string") return false;

  // expiresAt should be a number if present
  if (session.expiresAt != null && typeof session.expiresAt !== "number") return false;

  return true;
}

/**
 * Read session from signed cookie: payloadB64.sigB64
 * payload is JSON: { userId, email, role, expiresAt, ... }
 */
export function getSession(req) {
  const { keys } = getHmacKeys();
  if (!keys.length) return null;

  const cookieHeader = req?.headers?.cookie || "";
  const rawCookieVal = readCookieValue(cookieHeader, COOKIE_NAME);
  if (!rawCookieVal) return null;

  const raw = decodeURIComponent(rawCookieVal || "");
  const parts = raw.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;

  // NEW: accept any valid key (rotation support)
  let ok = false;
  for (const k of keys) {
    const expectedSig = sign(payloadB64, k);
    if (timingSafeEqualStr(sigB64, expectedSig)) {
      ok = true;
      break;
    }
  }
  if (!ok) return null;

  try {
    const decoded = base64urlDecode(payloadB64);

    // Optional decryption layer (if SESSION_ENC_KEY set)
    const maybeJson = decryptIfNeeded(decoded);
    if (!maybeJson) return null;

    const session = JSON.parse(maybeJson);

    if (!validateSessionShape(session)) return null;

    // Your original expiry logic (kept)
    if (typeof session.expiresAt === "number" && Date.now() > session.expiresAt) return null;

    return session;
  } catch {
    return null;
  }
}

/**
 * Create signed cookie value for a session object
 */
export function createSessionCookieValue(sessionObj) {
  const { primary } = getHmacKeys();
  if (!primary) throw new Error("Missing SESSION_SECRET");

  // Keep your schema flexible, but prevent obviously bad session objects
  if (!validateSessionShape(sessionObj)) {
    throw new Error("Invalid session object shape");
  }

  // Serialize JSON (then optionally encrypt)
  const payloadJson = JSON.stringify(sessionObj);
  const payloadProtected = encryptIfPossible(payloadJson);

  const payloadB64 = base64urlEncode(payloadProtected);
  const sigB64 = sign(payloadB64, primary);

  return `${payloadB64}.${sigB64}`;
}

/**
 * (Optional helper) Serialize secure Set-Cookie header value.
 * Use this wherever you set cookies, without changing your session format.
 */
export function createSetCookieHeader(cookieValue, options = {}) {
  const {
    maxAge, // seconds
    path = "/",
    httpOnly = true,
    sameSite = "Lax", // Lax | Strict | None
    secure = process.env.NODE_ENV === "production",
    domain, // optional
  } = options;

  // Note: SameSite=None requires Secure in modern browsers
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(cookieValue)}`];

  if (typeof maxAge === "number") parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (path) parts.push(`Path=${path}`);
  if (domain) parts.push(`Domain=${domain}`);
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (sameSite) parts.push(`SameSite=${sameSite}`);

  return parts.join("; ");
}

/**
 * (Optional helper) Clear cookie header
 */
export function createClearCookieHeader(options = {}) {
  return createSetCookieHeader("", { ...options, maxAge: 0 });
}

export { COOKIE_NAME };

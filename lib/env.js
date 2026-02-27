// lib/env.js
export function isProd() {
  return process.env.NODE_ENV === "production";
}

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export function getEnv(name, fallback = null) {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
}

/**
 * Call this once at startup (optional).
 * It does NOT change behavior unless you call it.
 */
export function validateProductionEnv() {
  if (!isProd()) return;

  // Auth/session secret (your current code uses SESSION_SECRET)
  if (!process.env.SESSION_SECRET) {
    throw new Error("Missing SESSION_SECRET in production");
  }

  // Optional but recommended: encryption key for session payload confidentiality
  // If you set it, it must be valid (your auth.js already safely ignores malformed keys)
  // Here we just encourage it:
  if (!process.env.SESSION_ENC_KEY) {
    // Not throwing, just warning-like behavior (do nothing).
    // If you want strict mode later, change to throw.
  }

  // Cron protection token (we'll use it in cron endpoint)
  if (!process.env.CRON_SECRET) {
    // same: optional strict later
  }
}

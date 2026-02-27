// lib/rateLimit.js

const RATE_KEY = "__REGORIXA_RATE_LIMIT__";
const LAST_CLEANUP_KEY = "__REGORIXA_RATE_LIMIT_CLEANUP__";

// hard limits to avoid abuse / misconfig
const MAX_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_MAX = 10_000;
const MAX_KEY_LEN = 200;

function getStore() {
  if (!globalThis[RATE_KEY]) {
    globalThis[RATE_KEY] = new Map(); // key -> { count, resetAt }
  }
  return globalThis[RATE_KEY];
}

function now() {
  return Date.now();
}

function normalizeKey(key) {
  const s = String(key || "").trim().toLowerCase();
  if (!s) return "_";
  return s.length > MAX_KEY_LEN ? s.slice(0, MAX_KEY_LEN) : s;
}

function clampConfig(windowMs, max) {
  const w =
    Number.isFinite(windowMs) && windowMs > 0
      ? Math.min(windowMs, MAX_WINDOW_MS)
      : 60_000;

  const m =
    Number.isFinite(max) && max > 0
      ? Math.min(max, MAX_MAX)
      : 100;

  return { windowMs: w, max: m };
}

function cleanupIfNeeded(store, t) {
  const last = globalThis[LAST_CLEANUP_KEY] || 0;
  // cleanup at most once per minute
  if (t - last < 60_000) return;

  for (const [k, v] of store.entries()) {
    if (!v || t > v.resetAt) {
      store.delete(k);
    }
  }
  globalThis[LAST_CLEANUP_KEY] = t;
}

/**
 * @param {string} key
 * @param {{ windowMs:number, max:number }}
 * @returns {{ ok:boolean, remaining:number, resetAt:number }}
 */
export function rateLimit(key, { windowMs, max }) {
  const store = getStore();
  const t = now();

  cleanupIfNeeded(store, t);

  const k = normalizeKey(key);
  const cfg = clampConfig(windowMs, max);

  const cur = store.get(k);

  if (!cur || t > cur.resetAt) {
    const resetAt = t + cfg.windowMs;
    store.set(k, { count: 1, resetAt });
    return { ok: true, remaining: cfg.max - 1, resetAt };
  }

  if (cur.count >= cfg.max) {
    return { ok: false, remaining: 0, resetAt: cur.resetAt };
  }

  cur.count += 1;
  store.set(k, cur);

  return {
    ok: true,
    remaining: Math.max(0, cfg.max - cur.count),
    resetAt: cur.resetAt,
  };
}


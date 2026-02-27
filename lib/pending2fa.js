import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

function b64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecode(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

function sign(payloadB64, secret) {
  // keep hex signature for backward compatibility
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("hex");
}

function getPendingSecret() {
  // پیشنهاد: یک secret جدا برای pending بذار. اگر نبود از SESSION_SECRET استفاده کن.
  return process.env.PENDING_2FA_SECRET || process.env.SESSION_SECRET || "";
}

function normEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return e;
}

function clampTtl(ttlMs) {
  const v = Number(ttlMs);
  const def = 5 * 60 * 1000;
  if (!Number.isFinite(v) || v <= 0) return def;

  // hard cap to reduce risk of long-lived tokens (15 minutes)
  const max = 15 * 60 * 1000;
  return Math.min(v, max);
}

function timingSafeEqualHex(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex), "hex");
    const b = Buffer.from(String(bHex), "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---- Optional one-time consumption store (file-based for now; DB later) ----

const DEFAULT_DATA_DIR = path.join(process.cwd(), ".data");
const DEFAULT_CONSUME_FILE = path.join(DEFAULT_DATA_DIR, "pending2fa_used.json");
const CONSUME_FILE = process.env.PENDING_2FA_CONSUME_FILE || ""; // if empty => stateless

async function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function readUsedNonces(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return {};
    return data;
  } catch {
    return {};
  }
}

async function writeUsedNoncesAtomic(filePath, obj) {
  await ensureDirForFile(filePath);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  const json = JSON.stringify(obj, null, 2);
  await fs.writeFile(tmp, json, "utf8");
  await fs.rename(tmp, filePath);
}

async function markNonceUsedOnce(nonce, exp) {
  // If consumption file not enabled, do nothing (stateless mode)
  const filePath = CONSUME_FILE || "";
  if (!filePath) return true;

  const finalPath = filePath === "default" ? DEFAULT_CONSUME_FILE : filePath;

  // simple in-process mutex like previous pattern
  const locks = globalThis.__regorixa_locks || (globalThis.__regorixa_locks = {});
  const key = `pending2fa:${finalPath}`;
  const prev = locks[key] || Promise.resolve();

  const run = prev
    .catch(() => {})
    .then(async () => {
      const used = await readUsedNonces(finalPath);

      // clean expired entries (best effort)
      const now = Date.now();
      for (const k of Object.keys(used)) {
        if (Number(used[k]) < now) delete used[k];
      }

      if (used[nonce]) {
        // already used (replay)
        return false;
      }

      used[nonce] = Number(exp) || (Date.now() + 60_000);
      await writeUsedNoncesAtomic(finalPath, used);
      return true;
    });

  locks[key] = run;
  return run;
}

/**
 * token format: <payloadB64url>.<sigHex>
 * payload json: { e: "<email>", exp: <unix_ms>, n: "<random>" }
 */
export function createPending2fa(email, ttlMs = 5 * 60 * 1000) {
  const secret = getPendingSecret();
  if (!secret) {
    throw new Error("Missing PENDING_2FA_SECRET or SESSION_SECRET");
  }

  const e = normEmail(email);
  if (!e) throw new Error("Missing email");

  const ttl = clampTtl(ttlMs);

  const payload = {
    e,
    exp: Date.now() + ttl,
    n: crypto.randomBytes(16).toString("hex"), // فقط برای یکتا شدن
  };

  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const sig = sign(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export function peekPending2fa(token) {
  try {
    const secret = getPendingSecret();
    if (!secret) return null;

    const raw = String(token || "").trim();
    const [payloadB64, sig] = raw.split(".");
    if (!payloadB64 || !sig) return null;

    const expected = sign(payloadB64, secret);
    if (!timingSafeEqualHex(sig, expected)) return null;

    const payloadJson = b64urlDecode(payloadB64).toString("utf8");
    const payload = JSON.parse(payloadJson);

    if (!payload || !payload.e || !payload.exp) return null;
    if (Date.now() > Number(payload.exp)) return null;

    return normEmail(payload.e);
  } catch {
    return null;
  }
}

export async function consumePending2fa(token) {
  // Previously stateless: consume == peek.
  // Now: still compatible, but if PENDING_2FA_CONSUME_FILE is set, it becomes one-time.
  try {
    const secret = getPendingSecret();
    if (!secret) return null;

    const raw = String(token || "").trim();
    const [payloadB64, sig] = raw.split(".");
    if (!payloadB64 || !sig) return null;

    const expected = sign(payloadB64, secret);
    if (!timingSafeEqualHex(sig, expected)) return null;

    const payloadJson = b64urlDecode(payloadB64).toString("utf8");
    const payload = JSON.parse(payloadJson);

    if (!payload || !payload.e || !payload.exp || !payload.n) return null;
    if (Date.now() > Number(payload.exp)) return null;

    const ok = await markNonceUsedOnce(String(payload.n), Number(payload.exp));
    if (!ok) return null;

    return normEmail(payload.e);
  } catch {
    return null;
  }
}

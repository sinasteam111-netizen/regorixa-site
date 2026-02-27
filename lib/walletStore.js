// lib/walletStore.js
import fs from "fs/promises";
import path from "path";
import { ensureDir, withFileLock, atomicWriteJson, readJsonFileSafe } from "./fileStoreSafe";

const DATA_DIR = path.join(process.cwd(), ".data");
const WALLETS_FILE = path.join(DATA_DIR, "wallets.json");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function ensureData() {
  await ensureDir(DATA_DIR);
}

/**
 * Accepts multiple legacy shapes and normalizes to:
 * {
 *   "user@email.com": { wallet: "T....", updatedAt: "...", ... },
 *   ...
 * }
 */
function normalizeWalletsToMap(v) {
  // Correct shape
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v;
  }

  // Legacy: array of objects
  if (Array.isArray(v)) {
    const out = {};
    for (const item of v) {
      if (!item) continue;

      // Case 1: [{ "email@x.com": { wallet: "...", ... } }]
      if (typeof item === "object" && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (keys.length === 1) {
          const k = normalizeEmail(keys[0]);
          const row = item[keys[0]];
          if (k && row && typeof row === "object") {
            out[k] = { ...(out[k] || {}), ...row };
            continue;
          }
        }

        // Case 2: [{ email: "email@x.com", wallet: "...", updatedAt: "...", ... }]
        const e = normalizeEmail(item.email);
        if (e) {
          const { email, ...rest } = item;
          out[e] = { ...(out[e] || {}), ...rest };
          continue;
        }
      }
    }
    return out;
  }

  return {};
}

/**
 * wallets.json schema (current):
 * {
 *   "user@email.com": { wallet: "T....", updatedAt: "..." },
 *   ...
 * }
 */
export async function readWalletsMap() {
  await ensureData();

  try {
    await fs.access(WALLETS_FILE);
  } catch {
    return {};
  }

  const raw = await readJsonFileSafe(WALLETS_FILE, {}, {
    backupOnCorrupt: true,
    backupDir: DATA_DIR,
  });

  const map = normalizeWalletsToMap(raw);

  // Optional: if legacy array was read, rewrite into normalized object (best-effort)
  // to permanently fix future reads, but do not break if write fails.
  try {
    if (Array.isArray(raw)) {
      await atomicWriteJson(WALLETS_FILE, map);
    }
  } catch {}

  return map;
}

export async function writeWalletsMap(mapObj) {
  await ensureData();
  const obj = normalizeWalletsToMap(mapObj);
  await atomicWriteJson(WALLETS_FILE, obj);
}

/**
 * Multi-process safe read (locks around read to avoid reading mid-write/rename)
 */
export async function readWalletsMapLocked() {
  return await withFileLock(WALLETS_FILE, async () => {
    return await readWalletsMap();
  });
}

/**
 * Upsert wallet row for email (locked + atomic)
 * Returns the stored row: { wallet, updatedAt, ... } or null (if no email)
 */
export async function upsertWalletRow(email, rowPatch) {
  const e = normalizeEmail(email);
  if (!e) return null;

  return await withFileLock(WALLETS_FILE, async () => {
    const map = await readWalletsMap();
    const prev = map[e] && typeof map[e] === "object" ? map[e] : {};
    map[e] = { ...prev, ...(rowPatch || {}) };
    await writeWalletsMap(map);
    return map[e];
  });
}

/**
 * Get wallet row for email (locked read)
 */
export async function getWalletRow(email) {
  const e = normalizeEmail(email);
  if (!e) return null;

  const map = await readWalletsMapLocked();
  return map[e] || null;
}

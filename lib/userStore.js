// lib/userStore.js
import fs from "fs/promises";
import path from "path";
import { atomicWriteJson, readJsonFileSafe, ensureDir } from "./fileStoreSafe";

const DATA_DIR = path.join(process.cwd(), ".data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const USERS_LOCK = path.join(DATA_DIR, "users.lock");

// --------------------
// In-process lock (kept)
// --------------------
const _locks = globalThis.__regorixa_locks || (globalThis.__regorixa_locks = {});
function withInProcessLock(key, fn) {
  const prev = _locks[key] || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  _locks[key] = next;
  return next;
}

// --------------------
// Cross-process lock (kept name: users.lock)
// --------------------
async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function acquireFileLock(lockPath, { timeoutMs = 10_000, retryMs = 50 } = {}) {
  const start = Date.now();
  await ensureDir(DATA_DIR);

  while (true) {
    try {
      const h = await fs.open(lockPath, "wx"); // create exclusively
      try {
        await h.writeFile(
          JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
          "utf8"
        );
      } catch {}
      return h;
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
      if (Date.now() - start > timeoutMs) {
        const err = new Error("Lock timeout");
        err.code = "LOCK_TIMEOUT";
        throw err;
      }
      await sleep(retryMs);
    }
  }
}

async function releaseFileLock(handle, lockPath) {
  try {
    await handle?.close?.();
  } catch {}
  try {
    await fs.unlink(lockPath);
  } catch {}
}

async function withFileLock(fn) {
  const h = await acquireFileLock(USERS_LOCK);
  try {
    return await fn();
  } finally {
    await releaseFileLock(h, USERS_LOCK);
  }
}

// --------------------
// Helpers
// --------------------
function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function ensureUsersFile() {
  await ensureDir(DATA_DIR);
  try {
    await fs.access(USERS_FILE);
  } catch {
    // create initial file atomically
    await atomicWriteJson(USERS_FILE, []);
  }
}

// --------------------
// Optional DB mode (non-breaking)
// --------------------
function dbEnabled() {
  return String(process.env.USE_DB || "").trim() === "1" && !!process.env.DATABASE_URL;
}

async function getPrisma() {
  try {
    const { getPrismaClient } = await import("./prismaClient");
    return await getPrismaClient();
  } catch {
    return null;
  }
}

// --------------------
// Public API (kept compatible)
// --------------------

export async function readUsers() {
  // DB mode (best effort)
  if (dbEnabled()) {
    const prisma = await getPrisma();
    if (prisma?.user?.findMany) {
      try {
        const rows = await prisma.user.findMany();
        return Array.isArray(rows) ? rows : [];
      } catch {
        // fall through to JSON
      }
    }
  }

  // IMPORTANT: behavior kept — if missing => []
  try {
    await fs.access(USERS_FILE);
  } catch {
    return [];
  }

  // Same behavior as before: corrupted/parse error => []
  // + backup best-effort
  return await readJsonFileSafe(USERS_FILE, [], {
    backupOnCorrupt: true,
    backupDir: DATA_DIR,
  });
}

export async function findUserByEmail(email) {
  const emailNorm = normEmail(email);
  if (!emailNorm) return null;

  // DB mode
  if (dbEnabled()) {
    const prisma = await getPrisma();
    if (prisma?.user?.findUnique) {
      try {
        const u = await prisma.user.findUnique({ where: { email: emailNorm } });
        return u || null;
      } catch {
        // fall back
      }
    }
  }

  const users = await readUsers();
  return (Array.isArray(users) ? users : []).find((u) => normEmail(u?.email) === emailNorm) || null;
}

export async function addUser(user) {
  // DB mode
  if (dbEnabled()) {
    const prisma = await getPrisma();
    if (prisma?.user?.create) {
      try {
        const email = normEmail(user?.email);
        if (email) {
          const created = await prisma.user.create({
            data: { ...user, email },
          });
          return created;
        }
      } catch {
        // fall back
      }
    }
  }

  // JSON mode (race-safe across process + in-process)
  return withInProcessLock(USERS_FILE, async () =>
    withFileLock(async () => {
      await ensureUsersFile();
      const users = await readUsers();
      const arr = Array.isArray(users) ? users : [];
      arr.push(user);
      await atomicWriteJson(USERS_FILE, arr);
      return user;
    })
  );
}

export async function writeUsers(users) {
  const arr = Array.isArray(users) ? users : [];

  return withInProcessLock(USERS_FILE, async () =>
    withFileLock(async () => {
      await ensureUsersFile();
      await atomicWriteJson(USERS_FILE, arr);
      return true;
    })
  );
}

export async function updateUserByEmail(email, patch) {
  const emailNorm = normEmail(email);
  if (!emailNorm) return null;

  // DB mode
  if (dbEnabled()) {
    const prisma = await getPrisma();
    if (prisma?.user?.update) {
      try {
        const updated = await prisma.user.update({
          where: { email: emailNorm },
          data: { ...(patch || {}) },
        });
        return updated || null;
      } catch {
        // fall back
      }
    }
  }

  // JSON mode (race-safe across process + in-process)
  return withInProcessLock(USERS_FILE, async () =>
    withFileLock(async () => {
      await ensureUsersFile();

      const users = await readUsers();
      const arr = Array.isArray(users) ? users : [];
      const idx = arr.findIndex((u) => normEmail(u?.email) === emailNorm);
      if (idx === -1) return null;

      arr[idx] = { ...arr[idx], ...(patch || {}) };
      await atomicWriteJson(USERS_FILE, arr);
      return arr[idx];
    })
  );
}

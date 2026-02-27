import crypto from "crypto";
import fs from "fs/promises";

import { requireAdmin } from "../../../lib/requireAdmin";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp } from "../../../lib/ipUa";
import { readWithdrawals, withWithdrawalsLock, getWithdrawalsPaths } from "../../../lib/withdrawalsStore";
import { makeAuditEvent, appendAuditEvent } from "../../../lib/auditLog";

// ---------- headers ----------
function setPrivateNoCache(res) {
  res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
}

// ---------- robust parsers ----------
function toInt(v, def, min, max) {
  const n = parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}
function toNumOrNaN(v) {
  if (v === undefined || v === null || String(v).trim() === "") return NaN;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : NaN;
}
function s(v) {
  return String(v ?? "").trim();
}
function sl(v) {
  return s(v).toLowerCase();
}
function safeStatus(v) {
  const x = sl(v);
  return x === "pending" || x === "approved" || x === "rejected" ? x : "";
}
function safeSort(v) {
  const x = sl(v);
  if (x === "createdat_asc") return "createdAt_asc";
  if (x === "amount_desc") return "amount_desc";
  if (x === "amount_asc") return "amount_asc";
  return "createdAt_desc";
}

function maskWallet(addr) {
  const w = s(addr);
  if (!w) return "";
  if (w.length <= 12) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

function pickFields(row, { includeFullWallet = false } = {}) {
  return {
    id: row?.id ?? null,
    email: row?.email ?? null,
    amount: row?.amount ?? null,
    status: row?.status ?? null,
    adminNote: row?.adminNote ?? "",
    createdAt: row?.createdAt ?? null,
    updatedAt: row?.updatedAt ?? null,
    resolvedBy: row?.resolvedBy ?? null,
    resolveId: row?.resolveId ?? null,
    walletAddress: includeFullWallet ? (row?.walletAddress ?? "") : maskWallet(row?.walletAddress),
  };
}

function applyFilters(rows, { status, email, q, minAmount, maxAmount } = {}) {
  let out = Array.isArray(rows) ? rows : [];

  if (status) out = out.filter((r) => sl(r?.status) === status);
  if (email) out = out.filter((r) => sl(r?.email) === sl(email));

  if (Number.isFinite(minAmount)) out = out.filter((r) => Number(r?.amount || 0) >= minAmount);
  if (Number.isFinite(maxAmount)) out = out.filter((r) => Number(r?.amount || 0) <= maxAmount);

  if (q) {
    const qq = sl(q);
    out = out.filter((r) => {
      const e = sl(r?.email);
      const id = sl(r?.id);
      const st = sl(r?.status);
      const wa = sl(r?.walletAddress);
      return e.includes(qq) || id.includes(qq) || st.includes(qq) || wa.includes(qq);
    });
  }

  return out;
}

// ---------- sorting ----------
function asTime(v) {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}
function cmpStr(a, b) {
  const A = String(a || "");
  const B = String(b || "");
  if (A < B) return -1;
  if (A > B) return 1;
  return 0;
}
function sortRows(rows, sort) {
  const out = rows.slice();

  if (sort === "createdAt_asc") {
    out.sort((x, y) => {
      const tx = asTime(x?.createdAt);
      const ty = asTime(y?.createdAt);
      if (tx !== ty) return tx - ty;
      return cmpStr(x?.id, y?.id);
    });
    return out;
  }

  if (sort === "amount_desc") {
    out.sort((x, y) => {
      const ax = Number(x?.amount || 0);
      const ay = Number(y?.amount || 0);
      if (ax !== ay) return ay - ax;
      const tx = asTime(x?.createdAt);
      const ty = asTime(y?.createdAt);
      if (tx !== ty) return ty - tx;
      return cmpStr(x?.id, y?.id);
    });
    return out;
  }

  if (sort === "amount_asc") {
    out.sort((x, y) => {
      const ax = Number(x?.amount || 0);
      const ay = Number(y?.amount || 0);
      if (ax !== ay) return ax - ay;
      const tx = asTime(x?.createdAt);
      const ty = asTime(y?.createdAt);
      if (tx !== ty) return tx - ty;
      return cmpStr(x?.id, y?.id);
    });
    return out;
  }

  // default: createdAt_desc
  out.sort((x, y) => {
    const tx = asTime(x?.createdAt);
    const ty = asTime(y?.createdAt);
    if (tx !== ty) return ty - tx;
    return cmpStr(x?.id, y?.id);
  });
  return out;
}

// ---------- cursor ----------
function encodeCursor(obj) {
  try {
    return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
  } catch {
    return "";
  }
}
function decodeCursor(cur) {
  try {
    const raw = Buffer.from(String(cur || ""), "base64url").toString("utf8");
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}
function isCursorCompatible(cursor, sort) {
  return cursor && cursor.sort === sort && typeof cursor.id === "string";
}
function pageByCursor(sortedRows, { sort, limit, cursorObj }) {
  let startIndex = 0;

  if (cursorObj && isCursorCompatible(cursorObj, sort)) {
    const cursorId = String(cursorObj.id);
    const idx = sortedRows.findIndex((r) => String(r?.id) === cursorId);
    if (idx >= 0) startIndex = idx + 1;
  }

  const slice = sortedRows.slice(startIndex, startIndex + limit);

  let nextCursor = null;
  if (startIndex + limit < sortedRows.length && slice.length > 0) {
    const last = slice[slice.length - 1];
    if (sort === "createdAt_desc" || sort === "createdAt_asc") {
      nextCursor = encodeCursor({ sort, t: asTime(last?.createdAt), id: String(last?.id || "") });
    } else {
      nextCursor = encodeCursor({ sort, a: Number(last?.amount || 0), id: String(last?.id || "") });
    }
  }

  return { slice, nextCursor };
}

// ---------- ETag ----------
async function computeWithdrawalsETag(prefix = "wdr") {
  try {
    const { WITHDRAWALS_FILE } = getWithdrawalsPaths();
    const st = await fs.stat(WITHDRAWALS_FILE);
    const base = `${st.size}:${st.mtimeMs}`;
    const h = crypto.createHash("sha1").update(base).digest("hex").slice(0, 16);
    return `W/"${prefix}-${h}"`;
  } catch {
    const h = crypto.createHash("sha1").update(String(Date.now())).digest("hex").slice(0, 16);
    return `W/"${prefix}-${h}"`;
  }
}

// -------------------- handler --------------------
export default async function handler(req, res) {
  try {
    setPrivateNoCache(res);

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // RL
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`admin:withdrawals:list:${ip}:${p}`, { windowMs: 60_000, max: 60 });
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {}

    const gate = await requireAdmin(req, res, { rateLimitKeyPrefix: "admin:withdrawals:list" });
    if (!gate) return;

    const adminEmail = String(gate.user?.email || "").toLowerCase();
    const role = String(gate.user?.role || "").toLowerCase();

    // ETag / 304
    const etag = await computeWithdrawalsETag("wdr-list");
    res.setHeader("ETag", etag);
    const inm = String(req.headers["if-none-match"] || "").trim();
    if (inm && inm === etag) return res.status(304).end();

    // query
    const limit = toInt(req.query?.limit, 50, 1, 200);

    const status = safeStatus(req.query?.status);
    const email = s(req.query?.email);
    const q = s(req.query?.q);
    const sort = safeSort(req.query?.sort);

    const minAmount = toNumOrNaN(req.query?.minAmount);
    const maxAmount = toNumOrNaN(req.query?.maxAmount);

    const cursorRaw = s(req.query?.cursor);
    const cursorObj = cursorRaw ? decodeCursor(cursorRaw) : null;

    // full wallet only super_admin
    const includeFullWallet = sl(req.query?.includeWallet) === "1" && role === "super_admin";

    // read
    const rows = await withWithdrawalsLock(async () => {
      const data = await readWithdrawals();
      return Array.isArray(data) ? data : [];
    });

    const filtered = applyFilters(rows, {
      status,
      email,
      q,
      minAmount: Number.isFinite(minAmount) ? minAmount : undefined,
      maxAmount: Number.isFinite(maxAmount) ? maxAmount : undefined,
    });

    const sorted = sortRows(filtered, sort);

    const { slice, nextCursor } = pageByCursor(sorted, { sort, limit, cursorObj });

    const withdrawals = slice.map((r) => pickFields(r, { includeFullWallet }));

    // audit (best-effort)
    try {
      const ip = getIp(req) || null;
      const ua = req.headers["user-agent"] || null;

      await appendAuditEvent(
        makeAuditEvent({
          actor: {
            type: "admin",
            id: gate.user?.id || gate.user?.userId || adminEmail || "admin",
            email: adminEmail || null,
            ip,
            ua,
          },
          action: "admin.withdrawals.list",
          target: { type: "withdrawals", id: null },
          ok: true,
          meta: {
            limit,
            sort,
            cursorUsed: !!cursorRaw,
            nextCursor: !!nextCursor,
            filters: {
              status: status || null,
              email: email || null,
              q: q || null,
              minAmount: Number.isFinite(minAmount) ? minAmount : null,
              maxAmount: Number.isFinite(maxAmount) ? maxAmount : null,
            },
            includeWallet: includeFullWallet,
          },
        })
      );
    } catch {}

    return res.status(200).json({
      ok: true,
      limit,
      sort,
      cursor: cursorRaw || null,
      nextCursor: nextCursor || null,
      withdrawals,
    });
  } catch (e) {
    console.error("withdrawals/list error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

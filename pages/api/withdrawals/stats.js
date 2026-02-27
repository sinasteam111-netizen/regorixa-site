import crypto from "crypto";
import fs from "fs/promises";

import { requireAdmin } from "../../../lib/requireAdmin";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp } from "../../../lib/ipUa";
import { readWithdrawals, withWithdrawalsLock, getWithdrawalsPaths } from "../../../lib/withdrawalsStore";
import { makeAuditEvent, appendAuditEvent } from "../../../lib/auditLog";

function setPrivateNoCache(res) {
  res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
}

function s(v) {
  return String(v ?? "").trim();
}
function sl(v) {
  return s(v).toLowerCase();
}

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

export default async function handler(req, res) {
  try {
    setPrivateNoCache(res);

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // RL (سبک‌تر)
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`admin:withdrawals:stats:${ip}:${p}`, { windowMs: 60_000, max: 120 });
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {}

    const gate = await requireAdmin(req, res, { rateLimitKeyPrefix: "admin:withdrawals:stats" });
    if (!gate) return;

    const adminEmail = String(gate.user?.email || "").toLowerCase();

    // ETag / 304
    const etag = await computeWithdrawalsETag("wdr-stats");
    res.setHeader("ETag", etag);
    const inm = String(req.headers["if-none-match"] || "").trim();
    if (inm && inm === etag) return res.status(304).end();

    const email = sl(req.query?.email); // optional: stats per user

    const rows = await withWithdrawalsLock(async () => {
      const data = await readWithdrawals();
      return Array.isArray(data) ? data : [];
    });

    const filtered = email ? rows.filter((r) => sl(r?.email) === email) : rows;

    const stats = {
      total: filtered.length,
      byStatus: { pending: 0, approved: 0, rejected: 0 },
      sumAmount: { pending: 0, approved: 0, rejected: 0, all: 0 },
      lastCreatedAt: null,
    };

    for (const r of filtered) {
      const st = sl(r?.status);
      const amt = Number(r?.amount || 0);
      if (st === "pending" || st === "approved" || st === "rejected") {
        stats.byStatus[st] += 1;
        stats.sumAmount[st] += amt;
      }
      stats.sumAmount.all += amt;

      const t = new Date(r?.createdAt || 0).getTime();
      if (Number.isFinite(t) && t > 0) {
        const prev = stats.lastCreatedAt ? new Date(stats.lastCreatedAt).getTime() : 0;
        if (!prev || t > prev) stats.lastCreatedAt = new Date(t).toISOString();
      }
    }

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
          action: "admin.withdrawals.stats",
          target: { type: "withdrawals", id: null },
          ok: true,
          meta: { scopedEmail: email || null },
        })
      );
    } catch {}

    return res.status(200).json({ ok: true, email: email || null, stats });
  } catch (e) {
    console.error("withdrawals/stats error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

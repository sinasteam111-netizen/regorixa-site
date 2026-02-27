// pages/api/auth/orders/admin-update.js
import { readOrders, writeOrders } from "../../../../lib/orderstore";
import { rateLimit } from "../../../../lib/rateLimit";
import { getIp } from "../../../../lib/ipUa";
import { adminAction } from "../../../../lib/adminAction";
import {
  normalizeOrderType,
  ensureFirstProfitExists,
} from "../../../../lib/investmentProfits";

import { sendPlanApprovedEmail, sendInvestmentApprovedEmail } from "../../../../lib/mailer";

function isPlainObject(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function safeJsonParse(maybeString) {
  if (maybeString && typeof maybeString === "string") {
    try {
      return JSON.parse(maybeString);
    } catch {
      return null;
    }
  }
  return maybeString;
}

function normalizeStatusPatch(patch) {
  // Pending verification (قدیمی/UI) -> Pending + statusText
  const p = { ...patch };

  if (typeof p.status === "string") {
    const s = p.status.trim();

    if (s === "Pending verification") {
      p.status = "Pending";
      if (p.statusText == null) p.statusText = "Pending verification";
    }

    if (s === "Pending" && p.statusText == null) {
      p.statusText = "Pending verification";
    }
  }

  return p;
}

const ALLOWED_PATCH_KEYS = new Set([
  "status",
  "statusText",
  "orderType",
  "profits",
  "investmentStartedAt",
  "adminNote",
]);

function sanitizePatch(patch) {
  if (!isPlainObject(patch)) return null;

  const forbidden = new Set(["__proto__", "prototype", "constructor"]);
  const clean = {};

  for (const [k, v] of Object.entries(patch)) {
    if (forbidden.has(k)) continue;
    if (!ALLOWED_PATCH_KEYS.has(k)) continue;
    clean[k] = v;
  }

  return normalizeStatusPatch(clean);
}

function normalizeEmail(x) {
  return String(x || "").trim().toLowerCase();
}

function getNextProfitAt(order) {
  const profits = Array.isArray(order?.profits) ? order.profits : [];
  if (!profits.length) return null;

  // سعی می‌کنیم از اولین profit پرداخت‌نشده تاریخ رو دربیاریم
  const dateKeys = ["at", "date", "dueAt", "dueDate", "profitAt", "payoutAt", "time", "ts"];
  const pendingStatuses = new Set(["Pending", "pending", "Unpaid", "unpaid", "Open", "open"]);

  const candidates = profits
    .map((p) => {
      const st = String(p?.status || p?.state || "").trim();
      let dt = null;
      for (const k of dateKeys) {
        if (p?.[k]) {
          const dd = new Date(p[k]);
          if (!Number.isNaN(dd.getTime())) {
            dt = dd;
            break;
          }
        }
      }
      return { p, st, dt };
    })
    .filter((x) => x.dt && (pendingStatuses.has(x.st) || x.p?.paid !== true))
    .sort((a, b) => a.dt - b.dt);

  return candidates.length ? candidates[0].dt.toISOString() : null;
}

export default adminAction(
  {
    action: "admin.orders.update",

    target: (req) => {
      const body = req.bodyParsed || {};
      return { type: "order", id: String(body?.id || "") };
    },

    getBefore: async (req) => {
      const body = req.bodyParsed || {};
      const id = String(body?.id || "");
      if (!id) return null;

      const raw = await readOrders();
      const orders = Array.isArray(raw) ? raw : [];
      const prev = orders.find((o) => String(o?.id) === id);
      if (!prev) return null;

      return {
        id: String(prev.id),
        orderType: prev.orderType || null,
        status: prev.status || null,
        statusText: prev.statusText || null,
        plan: prev.plan || null,
        amount: prev.amount ?? null,
        userEmail: prev.userEmail || null,
        investmentStartedAt: prev.investmentStartedAt || null,
        profitsCount: Array.isArray(prev.profits) ? prev.profits.length : 0,
        updatedAt: prev.updatedAt || null,
      };
    },

    getAfter: async (req) => {
      const body = req.bodyParsed || {};
      const id = String(body?.id || "");
      if (!id) return null;

      const raw = await readOrders();
      const orders = Array.isArray(raw) ? raw : [];
      const next = orders.find((o) => String(o?.id) === id);
      if (!next) return null;

      return {
        id: String(next.id),
        orderType: next.orderType || null,
        status: next.status || null,
        statusText: next.statusText || null,
        plan: next.plan || null,
        amount: next.amount ?? null,
        userEmail: next.userEmail || null,
        investmentStartedAt: next.investmentStartedAt || null,
        profitsCount: Array.isArray(next.profits) ? next.profits.length : 0,
        updatedAt: next.updatedAt || null,
      };
    },

    meta: (req) => {
      const body = req.bodyParsed || {};
      return { patchKeys: Object.keys(body?.patch || {}) };
    },
  },
  async (req, res, auth) => {
    try {
      const ip = getIp(req);
      const email = String(auth?.session?.email || auth?.user?.email || "unknown").toLowerCase();

      const key = `admin:orders:update:${ip}:${email}`;
      const rl = rateLimit(key, { windowMs: 60 * 1000, max: 20 });
      if (!rl.ok) {
        return res
          .status(429)
          .json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {}

    const body = req.bodyParsed || {};
    const id = String(body.id || "").trim();
    const patchRaw = body.patch;

    const patch = sanitizePatch(patchRaw);

    if (!id || !patch) {
      return res.status(400).json({ ok: false, error: "Missing id/patch" });
    }

    const ordersRaw = await readOrders();
    const orders = Array.isArray(ordersRaw) ? ordersRaw : [];

    const idx = orders.findIndex((o) => String(o?.id) === id);
    if (idx === -1) {
      return res.status(404).json({ ok: false, error: "Order not found" });
    }

    const prev = orders[idx];
    const prevStatus = String(prev?.status || "");
    const prevType = normalizeOrderType(prev); // "plan" | "investment"
    const nowISO = new Date().toISOString();

    let next = { ...prev, ...patch, updatedAt: nowISO };

    if (typeof next.status === "string") {
      const s = next.status.trim();
      if (s !== "Pending" && s !== "Approved" && s !== "Rejected") {
        next.status = "Pending";
        next.statusText = "Pending verification";
      }
    } else {
      next.status = prev.status || "Pending";
    }

    const nextType = normalizeOrderType(next);
    next.orderType = nextType;

    const nextStatus = String(next.status || "");

    if (nextType === "investment" && nextStatus === "Approved") {
      if (!next.investmentStartedAt) {
        next.investmentStartedAt = next.createdAt || nowISO;
      }
      next = ensureFirstProfitExists(next);
    }

    orders[idx] = next;
    await writeOrders(orders);

    // ✅ SEND EMAILS when admin clicks Approve
try {
  const patchStatus = String(patch?.status || "").trim();
  const approveClicked = patchStatus === "Approved"; // ✅ مهم

  const emailTo = normalizeEmail(next?.userEmail || prev?.userEmail);

  if (approveClicked && nextStatus === "Approved" && emailTo) {
    // ✅ statusText را هم با Approved هماهنگ کنیم
    if (next.statusText === "Pending verification") {
      next.statusText = "Approved";
      orders[idx] = next;
      await writeOrders(orders);
    }

    if (nextType === "plan") {
      await sendPlanApprovedEmail({
        to: emailTo,
        planName: next?.plan,
        req,
      });
    }

    if (nextType === "investment") {
      const nextProfitAt = getNextProfitAt(next);

      await sendInvestmentApprovedEmail({
        to: emailTo,
        planName: next?.plan,
        amount: next?.amount,
        nextProfitAt,
        req,
      });
    }
  }
} catch (e) {
  console.error("approve email error:", e);
  // fail-safe: do not break admin approve flow
}

    return res.status(200).json({ ok: true, order: next });
  }
);
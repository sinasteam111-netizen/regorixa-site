// pages/api/admin/payouts/mark-paid.js
import fs from "fs/promises";
import path from "path";
import { adminAction } from "../../../../lib/adminAction";
import { getPublicBaseUrl } from "../../../../lib/baseUrl";
import { rateLimit } from "../../../../lib/rateLimit";
import { makeAuditEvent, appendAuditEvent } from "../../../../lib/auditLog";
import { normalizeOrderType, ensureFirstProfitExists, generateNextProfit } from "../../../../lib/investmentProfits";

const DATA_DIR = path.join(process.cwd(), ".data");
const ordersPath = path.join(DATA_DIR, "orders.json");
const walletsPath = path.join(DATA_DIR, "wallets.json");

// -------------------- lock / atomic helpers --------------------
const _locks = globalThis.__regorixa_locks || (globalThis.__regorixa_locks = {});
function withLock(key, fn) {
  const prev = _locks[key] || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  _locks[key] = next;
  return next;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJsonSafe(filePath, fallback) {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    return data ?? fallback;
  } catch {
    return fallback;
  }
}

async function atomicWriteJson(filePath, data) {
  await ensureDataDir();
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

// -------------------- misc helpers --------------------
function cleanNoCrlf(v) {
  return String(v || "").replace(/[\r\n]+/g, " ").trim();
}

function getSafeBaseUrl(req) {
  const envUrl = String(
    process.env.NEXT_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || ""
  ).trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  return cleanNoCrlf(getPublicBaseUrl(req)).replace(/\/+$/, "");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getWalletByEmail(walletsObj, email) {
  const e = normalizeEmail(email);
  if (!e) return "";
  const w1 = walletsObj?.[e]?.wallet;
  const w2 = walletsObj?.[String(email || "").trim()]?.wallet;
  return String(w1 || w2 || "").trim();
}

function toSofiaDayKey(dateLike) {
  const d = new Date(dateLike);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}

// -------------------- network helpers --------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postWithRetry(url, options, retries = 3) {
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) lastErr = new Error(`HTTP ${res.status}`);
      else return { ok: true, status: res.status };
    } catch (e) {
      lastErr = e;
    }
    await sleep(350 * Math.pow(2, i));
  }
  return { ok: false, error: lastErr ? String(lastErr.message || lastErr) : "Unknown error" };
}

export default adminAction(
  {
    action: "admin.payouts.mark_paid",
    target: (req) => ({ type: "investment_profit", id: String(req.body?.orderId || "") }),
    meta: (req) => ({
      orderId: String(req.body?.orderId || ""),
      dueAt: req.body?.dueAt ? String(req.body.dueAt) : null,
    }),
  },
  async (req, res, gate) => {
    // ✅ small rate-limit to reduce accidental storms
    const adminEmail = String(gate.user?.email || "").toLowerCase();
    const rl = rateLimit(`payout:mark_paid:admin:${adminEmail}`, { windowMs: 60_000, max: 180 });
    if (!rl.ok) {
      return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
    }

    const { orderId, dueAt } = req.body || {};
    if (!orderId) return res.status(400).json({ ok: false, error: "orderId is required" });

    const baseUrl = getSafeBaseUrl(req);

    const payoutAudit = async ({ ok, reason, payload }) => {
      const ev = makeAuditEvent({
        actor: {
          type: "admin",
          id: gate.user?.id || gate.user?.userId || adminEmail || "admin",
          email: adminEmail || null,
          ip: (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() || null,
          ua: req.headers["user-agent"] || null,
        },
        action: "payout_mark_paid",
        target: { type: "order", id: String(orderId) },
        ok,
        reason: reason || null,
        meta: payload || null,
      });
      await appendAuditEvent(ev);
    };

    const result = await withLock(ordersPath, async () => {
      const orders = await readJsonSafe(ordersPath, []);
      const idx = orders.findIndex((o) => String(o?.id) === String(orderId));
      if (idx === -1) {
        await payoutAudit({ ok: false, reason: "Order not found", payload: { orderId } });
        return { status: 404, body: { ok: false, error: "Order not found" } };
      }

      let order = orders[idx];

      if (normalizeOrderType(order) !== "investment") {
        await payoutAudit({ ok: false, reason: "Not an investment order", payload: { orderId } });
        return { status: 400, body: { ok: false, error: "Not an investment order" } };
      }
      if (String(order.status || "") !== "Approved") {
        await payoutAudit({ ok: false, reason: "Order must be Approved", payload: { orderId } });
        return { status: 400, body: { ok: false, error: "Order must be Approved" } };
      }

      order = ensureFirstProfitExists(order);
      const profits = Array.isArray(order.profits) ? order.profits.slice() : [];
      const todayKey = toSofiaDayKey(new Date());

      let pIndex = -1;

      if (dueAt) {
        const target = String(dueAt);
        pIndex = profits.findIndex(
          (p) => p && p.paid === false && String(p.dueAt || "") === target
        );
      }

      if (pIndex === -1) {
        pIndex = profits.findIndex(
          (p) => p && p.paid === false && p.dueAt && toSofiaDayKey(p.dueAt) === todayKey
        );
      }

      if (pIndex === -1) {
        await payoutAudit({
          ok: false,
          reason: "No unpaid profit due today for this order",
          payload: { orderId, dueAt: dueAt ? String(dueAt) : null, todayKey },
        });
        return { status: 400, body: { ok: false, error: "No unpaid profit due today for this order" } };
      }

      if (profits[pIndex]?.paid === true) {
        await payoutAudit({
          ok: true,
          reason: "Already paid (idempotent)",
          payload: { orderId, paidDueAt: profits[pIndex]?.dueAt || null },
        });
        return { status: 200, body: { ok: true, already: true, order } };
      }

      const nowISO = new Date().toISOString();
      profits[pIndex] = { ...profits[pIndex], paid: true, paidAt: nowISO };

      const hasOtherUnpaid = profits.some((p) => p && p.paid === false);
      if (!hasOtherUnpaid) {
        profits.push(generateNextProfit({ ...order, profits }));
      }

      orders[idx] = { ...order, profits };
      await atomicWriteJson(ordersPath, orders);

      const walletsObj = await readJsonSafe(walletsPath, {});
      const payoutWallet = getWalletByEmail(walletsObj, order.userEmail);

      await payoutAudit({
        ok: true,
        payload: {
          orderId: String(orderId),
          userEmail: order.userEmail,
          plan: order.plan,
          amount: order.amount,
          payoutWallet,
          paidMonth: profits[pIndex]?.month || null,
          paidDueAt: profits[pIndex]?.dueAt || null,
          paidAt: nowISO,
        },
      });

      return {
        status: 200,
        body: {
          ok: true,
          order: orders[idx],
          payoutInfo: {
            orderId: String(orderId),
            plan: order.plan,
            userEmail: order.userEmail,
            investedAmount: Number(order.amount || 0),
            investedAt: order.createdAt || null,
            payoutWallet,
            paidMonth: profits[pIndex]?.month || null,
            paidDueAt: profits[pIndex]?.dueAt || null,
            paidAt: nowISO,
          },
        },
        notify: { email: order.userEmail, plan: order.plan },
      };
    });

    if (result?.status === 200 && result?.notify?.email) {
      const email = String(result.notify.email || "");
      const plan = String(result.notify.plan || "").toUpperCase();

      try {
        await postWithRetry(`${baseUrl}/api/notifications/add`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            title: "Monthly profit paid",
            message: `Your monthly profit for ${plan} plan has been paid.`,
          }),
        });
      } catch {}

      try {
        await postWithRetry(`${baseUrl}/api/mail/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: email,
            subject: "Your monthly profit has been paid",
            text: `Hello,\n\nYour monthly profit for ${plan} plan has been paid successfully.\n\nREGORIXA`,
          }),
        });
      } catch {}
    }

    return res.status(result.status).json(result.body);
  }
);

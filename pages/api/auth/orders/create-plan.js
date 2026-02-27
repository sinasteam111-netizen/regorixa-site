import crypto from "crypto";
import { getSession } from "../../../../lib/auth";
import { addOrder, getOrdersByEmail, updateOrderById, txidExists } from "../../../../lib/orderstore";
import { rateLimit } from "../../../../lib/rateLimit";
import { getIp } from "../../../../lib/ipUa";
import { findUserByEmail } from "../../../../lib/userStore";

const APPROVAL_WINDOW_HOURS = { min: 1, max: 6 };

// -------- headers --------
function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

// -------- helpers --------
function normalizePlan(p) {
  const s = String(p || "").toLowerCase();
  if (s === "adv") return "advanced";
  if (s === "basic") return "base";
  return s;
}

function isValidTxId(txid) {
  const s = String(txid || "").trim();
  return s.length >= 20;
}

function normTxid(x) {
  let s = String(x || "").trim();
  if (!s) return "";
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  s = s.replace(/\s+/g, "");
  return s.toLowerCase();
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

function toAmountNumber(v) {
  const raw = String(v ?? "").trim();
  if (!raw) return NaN;
  const cleaned = raw.replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function minAmountForPlan(planNorm) {
  if (planNorm === "vip") return 1000;
  if (planNorm === "advanced") return 200;
  return 100; // base
}

function maxAmountForPlan() {
  return 1_000_000;
}

function amountStepForPlan() {
  return 1;
}

function isMultipleOf(n, step) {
  if (!Number.isFinite(n) || !Number.isFinite(step) || step <= 0) return false;
  const tol = 1e-9;
  const q = n / step;
  return Math.abs(q - Math.round(q)) < tol;
}

function isPendingStatus(o) {
  const s = String(o?.status || o?.statusText || "").toLowerCase();
  return s.includes("pending") || s.includes("verification");
}

export default async function handler(req, res) {
  try {
    noStore(res);

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ Rate limit
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`user:create-plan:${ip}:${p}`, { windowMs: 60 * 1000, max: 10 });
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {}

    // ✅ Session
    const session = await Promise.resolve(getSession(req));
    if (!session) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const email = String(session.email || session.user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ ok: false, error: "Not authenticated (email missing)" });

    // ✅ Body: object OR string
    const body = safeJsonParse(req.body) || {};
    const { plan, txid, amount } = body;

    const planNorm = normalizePlan(plan);
    if (planNorm !== "base" && planNorm !== "advanced" && planNorm !== "vip") {
      return res.status(400).json({ ok: false, error: "Invalid plan" });
    }

    if (!isValidTxId(txid)) {
      return res.status(400).json({ ok: false, error: "Invalid TxID" });
    }

    const txidRaw = String(txid).trim();
    const txidNorm = normTxid(txidRaw);
    if (!txidNorm) return res.status(400).json({ ok: false, error: "Invalid TxID" });

    // ✅ Security check (non-breaking)
    try {
      const user = await findUserByEmail(email);
      if (user?.email) {
        if (session.userId != null && user.id != null) {
          const sid = String(session.userId);
          const uid = String(user.id);
          if (sid && uid && sid !== uid) {
            return res.status(401).json({ ok: false, error: "Not authenticated" });
          }
        }
      }
    } catch {}

    // ✅ Amount
    const minA = minAmountForPlan(planNorm);
    const maxA = maxAmountForPlan(planNorm);
    const step = amountStepForPlan(planNorm);

    const amountNum = amount == null || String(amount).trim() === "" ? NaN : toAmountNumber(amount);
    const finalAmount = Number.isFinite(amountNum) ? amountNum : minA;

    if (!Number.isFinite(finalAmount) || finalAmount < minA || finalAmount > maxA) {
      return res.status(400).json({
        ok: false,
        error: `Invalid amount. Min for ${planNorm.toUpperCase()} is ${minA} USDT.`,
      });
    }

    if (!isMultipleOf(finalAmount, step)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid amount step. Must be multiple of ${step}.`,
      });
    }

    // ✅ Load my orders
    const myOrders = await getOrdersByEmail(email);
    const myList = Array.isArray(myOrders) ? myOrders : [];

    // ✅ If user has a pending investment for same plan, update it
    const pendingSamePlan = myList.find((o) => {
      const p = String(o?.plan || "").toLowerCase();
      const t = String(o?.orderType || "").toLowerCase();
      return p === planNorm && t === "investment" && isPendingStatus(o);
    });

    // ✅ GLOBAL duplicate check
    const dup = await txidExists(txidNorm, {
      excludeOrderId: pendingSamePlan?.id ? String(pendingSamePlan.id) : "",
    });

    // ✅ If dup, but the same user already has THIS txid on a pending order => update that order instead of 409
    if (dup) {
      const myPendingSameTx = myList.find((o) => {
        const t = String(o?.orderType || "").toLowerCase();
        return t === "investment" && isPendingStatus(o) && String(o?.txidNorm || "").toLowerCase() === txidNorm;
      });

      if (myPendingSameTx?.id) {
        const nowISO = new Date().toISOString();
        const etaText = `${APPROVAL_WINDOW_HOURS.min}–${APPROVAL_WINDOW_HOURS.max} hours`;
        const etaMinAt = new Date(Date.now() + APPROVAL_WINDOW_HOURS.min * 60 * 60 * 1000).toISOString();
        const etaMaxAt = new Date(Date.now() + APPROVAL_WINDOW_HOURS.max * 60 * 60 * 1000).toISOString();

        const updated = await updateOrderById(String(myPendingSameTx.id), {
          plan: planNorm, // اگر قبلاً پلن اشتباه بوده، اینجا اصلاح میشه
          txid: txidRaw,
          txidNorm,
          amount: finalAmount,
          etaText,
          etaMinAt,
          etaMaxAt,
          status: "Pending",
          statusText: "Pending verification",
          updatedAt: nowISO,
        });

        return res.status(200).json({
          ok: true,
          order: updated,
          message: `Updated existing pending request. ETA: ${etaText}`,
        });
      }

      // Otherwise: truly duplicate (another order / another user / already processed)
      return res.status(409).json({
        ok: false,
        error: "This TxID was already submitted. Use a new TxID.",
      });
    }

    const nowISO = new Date().toISOString();
    const etaText = `${APPROVAL_WINDOW_HOURS.min}–${APPROVAL_WINDOW_HOURS.max} hours`;
    const etaMinAt = new Date(Date.now() + APPROVAL_WINDOW_HOURS.min * 60 * 60 * 1000).toISOString();
    const etaMaxAt = new Date(Date.now() + APPROVAL_WINDOW_HOURS.max * 60 * 60 * 1000).toISOString();

    // ✅ Update existing pending order (same plan)
    if (pendingSamePlan?.id) {
      const updated = await updateOrderById(String(pendingSamePlan.id), {
        txid: txidRaw,
        txidNorm,
        amount: finalAmount,
        etaText,
        etaMinAt,
        etaMaxAt,
        status: "Pending",
        statusText: "Pending verification",
        updatedAt: nowISO,
      });

      return res.status(200).json({
        ok: true,
        order: updated,
        message: `Updated. ETA: ${etaText}`,
      });
    }

    // ✅ Create new order
    const order = {
      id: crypto.randomUUID(),
      plan: planNorm,
      orderType: "investment",
      amount: finalAmount,
      network: "TRC20",

      // ✅ فقط همین تغییر: ولت سرمایه‌گذاری جدا
      wallet: process.env.USDT_TRC20_WALLET_INVEST || "",

      txid: txidRaw,
      txidNorm,
      userEmail: email,
      status: "Pending",
      statusText: "Pending verification",
      createdAt: nowISO,
      updatedAt: nowISO,
      etaText,
      etaMinAt,
      etaMaxAt,
      profits: [],
      isFree: false,
    };

    await addOrder(order);

    return res.status(200).json({
      ok: true,
      order,
      message: `Submitted. ETA: ${etaText}`,
    });
  } catch (e) {
    console.error("create-plan error:", e);

    if (e?.code === "TXID_DUPLICATE" || e?.message === "TXID_DUPLICATE") {
      return res.status(409).json({ ok: false, error: "This TxID was already submitted." });
    }

    if (e?.message === "DATA_DIR_NOT_WRITABLE") {
      return res.status(500).json({ ok: false, error: "Storage is not writable on this host. Use VPS or DB." });
    }

    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
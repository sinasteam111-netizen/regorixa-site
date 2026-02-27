// pages/api/admin/payouts/today.js
import fs from "fs/promises";
import path from "path";
import { requireAdmin } from "../../../../lib/requireAdmin";

const DATA_DIR = path.join(process.cwd(), ".data");
const ordersPath = path.join(DATA_DIR, "orders.json");
const walletsPath = path.join(DATA_DIR, "wallets.json");

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

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getWalletByEmail(walletsObj, email) {
  const e = normalizeEmail(email);
  if (!e) return "";

  // ✅ هم lowercase و هم حالت قبلی (اگر قبلاً با حروف متفاوت ذخیره شده بود)
  const w1 = walletsObj?.[e]?.wallet;
  const w2 = walletsObj?.[String(email || "").trim()]?.wallet;

  return String(w1 || w2 || "").trim();
}

function normalizeOrderType(o) {
  const t = String(o?.orderType || "").trim().toLowerCase();
  return t === "investment" ? "investment" : "plan";
}

function generateNextProfit(order) {
  const profits = Array.isArray(order.profits) ? order.profits : [];
  const nextMonth = profits.length + 1;

  let baseDate;
  if (profits.length === 0) {
    baseDate = order.investmentStartedAt || order.createdAt || new Date().toISOString();
  } else {
    baseDate = profits[profits.length - 1].dueAt;
  }

  const due = addMonthsClampedUTC(baseDate, 1);

  return {
    month: nextMonth,
    dueAt: due.toISOString(),
    paid: false,
    paidAt: null,
  };
}

function daysInMonthUTC(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function addMonthsClampedUTC(dateLike, monthsToAdd) {
  const d = new Date(dateLike);

  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();

  const targetMonth = m + monthsToAdd;
  const targetYear = y + Math.floor(targetMonth / 12);
  const targetMonth0 = ((targetMonth % 12) + 12) % 12;

  const dim = daysInMonthUTC(targetYear, targetMonth0);
  const clampedDay = Math.min(day, dim);

  return new Date(Date.UTC(targetYear, targetMonth0, clampedDay, 12, 0, 0, 0));
}

function ensureFirstProfitExists(order) {
  const o = { ...order };
  if (!Array.isArray(o.profits)) o.profits = [];
  if (o.profits.length === 0) {
    o.profits.push(generateNextProfit(o));
  }
  return o;
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

function sanitizePlan(x) {
  const p = norm(x);
  if (p === "base" || p === "advanced" || p === "vip" || p === "all") return p;
  return "all";
}
export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ admin gate (session + real user + role)
    const gate = await requireAdmin(req, res, { allowRoles: ["admin", "super_admin"] });
    if (!gate) return;

    const plan = sanitizePlan(req.query.plan || "all"); // all | base | advanced | vip
    const todayKey = toSofiaDayKey(new Date());

    const orders = await readJsonSafe(ordersPath, []);
    const walletsObj = await readJsonSafe(walletsPath, {});

    const items = [];

    for (const raw of orders || []) {
      if (!raw) continue;

      // فقط investment + approved
      if (normalizeOrderType(raw) !== "investment") continue;
      if (String(raw.status || "") !== "Approved") continue;

      const p = norm(raw.plan);
      if (plan !== "all" && p !== plan) continue;

      const o = ensureFirstProfitExists(raw);
      const profits = Array.isArray(o.profits) ? o.profits : [];

      // اولین unpaid که due today باشه
      const dueProfit = profits.find(
        (pp) => pp && pp.paid === false && pp.dueAt && toSofiaDayKey(pp.dueAt) === todayKey
      );
      if (!dueProfit) continue;

      const payoutWallet = getWalletByEmail(walletsObj, o.userEmail);

      items.push({
        orderId: String(o.id || ""),
        plan: o.plan,
        userEmail: o.userEmail,

        // ✅ کیف پول واقعی کاربر از wallets.json
        payoutWallet,

        investedAmount: Number(o.amount || 0),
        investedAt: o.createdAt || null,

        dueAt: dueProfit.dueAt,
        month: dueProfit.month || null,

        status: o.status,
      });
    }

    items.sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0));

    const base = items.filter((x) => norm(x.plan) === "base");
    const advanced = items.filter((x) => norm(x.plan) === "advanced");
    const vip = items.filter((x) => norm(x.plan) === "vip");

    return res.status(200).json({
      ok: true,

      // ✅ اینا همون چیزیه که UI تو می‌خواد
      today: todayKey,
      count: items.length,
      base,
      advanced,
      vip,

      // ✅ برای سازگاری/دیباگ هم نگه می‌داریم
      dateSofia: todayKey,
      total: items.length,
      items,
    });
  } catch (e) {
    console.error("admin/payouts/today error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

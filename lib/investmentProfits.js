// lib/investmentProfits.js

export function normalizeOrderType(o) {
  const t = String(o?.orderType || "").trim().toLowerCase();
  return t === "investment" ? "investment" : "plan";
}

function daysInMonthUTC(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/**
 * Clamp month add (UTC) + fixed hour (12:00) to reduce TZ/DST weirdness
 */
export function addMonthsClampedUTC(dateLike, monthsToAdd) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return new Date(Date.UTC(1970, 0, 1, 12, 0, 0, 0));

  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();

  const targetMonth = m + Number(monthsToAdd || 0);
  const targetYear = y + Math.floor(targetMonth / 12);
  const targetMonth0 = ((targetMonth % 12) + 12) % 12;

  const dim = daysInMonthUTC(targetYear, targetMonth0);
  const clampedDay = Math.min(day, dim);

  return new Date(Date.UTC(targetYear, targetMonth0, clampedDay, 12, 0, 0, 0));
}

/**
 * Next profit:
 * - month increments by profits.length + 1
 * - base date: investmentStartedAt/createdAt for first, otherwise last dueAt
 * - dueAt = addMonthsClampedUTC(base, 1)
 */
export function generateNextProfit(order) {
  const profits = Array.isArray(order?.profits) ? order.profits : [];
  const nextMonth = profits.length + 1;

  const baseDate =
    profits.length === 0
      ? order?.investmentStartedAt || order?.createdAt || new Date().toISOString()
      : profits[profits.length - 1]?.dueAt;

  const due = addMonthsClampedUTC(baseDate, 1);

  return {
    month: nextMonth,
    dueAt: due.toISOString(),
    paid: false,
    paidAt: null,
    amount: null, // NEW field you added
  };
}

export function ensureFirstProfitExists(order) {
  const o = { ...order };
  if (!Array.isArray(o.profits)) o.profits = [];
  if (o.profits.length === 0) {
    o.profits.push(generateNextProfit(o));
  }
  return o;
}

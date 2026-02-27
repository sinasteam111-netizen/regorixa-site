import crypto from "crypto";
import { getSession } from "../../../lib/auth";
import { findUserByEmail } from "../../../lib/userStore";
import { readOrders } from "../../../lib/orderstore";
import { sendWithdrawalRequestReceivedEmail } from "../../../lib/mailer";
import { getIp, getUa } from "../../../lib/requestMeta";
import { rateLimit } from "../../../lib/rateLimit";
import { setNoStore } from "../../../lib/noStore";
import { makeAuditEvent, appendAuditEvent } from "../../../lib/auditLog";
import {
  readWithdrawals,
  writeWithdrawals,
  withWithdrawalsLock,
  appendWithdrawalsAudit,
} from "../../../lib/withdrawalsStore";
import { verifyCsrf, rejectCsrf } from "../../../lib/csrf";
import { applySecurityHeaders } from "../../../lib/securityHeaders";

/**
 * NOTE:
 * این تکه قبلاً به صورت export default آمده بود و باعث دو default export می‌شد.
 * برای حفظش و جلوگیری از شکستن build، به کامنت تبدیل شد.
 *
 * export default async function handler(req, res) {
 *   if (!verifyCsrf(req)) return rejectCsrf(res);
 *   // ... rest of your existing code (بدون حذف)
 * }
 */

// ✅ rate limit settings (business rule)
const WITHDRAW_RATE_LIMIT_WINDOW_MIN = 60; // 60 minutes window
const WITHDRAW_RATE_LIMIT_MAX = 1; // max 1 request per window (per user)

// -------------------- helpers --------------------
function safeId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function cleanNoCrlf(v) {
  return String(v || "").replace(/[\r\n]+/g, " ").trim();
}

function clampLen(v, max = 300) {
  const s = String(v || "");
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function maskWallet(addr) {
  const s = String(addr || "").trim();
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function auditUser(req, email, action, ok, { reason = null, meta = null, targetId = null } = {}) {
  const ip = getIp(req) || "unknown";
  const ua = clampLen(cleanNoCrlf(getUa(req)), 300);

  // best-effort (نباید روند اصلی را خراب کند)
  try {
    appendAuditEvent(
      makeAuditEvent({
        actor: { type: "user", id: email, email, ip, ua },
        action,
        target: { type: "withdrawal_request", id: targetId || null },
        ok,
        reason,
        meta,
      })
    );
  } catch {}
}

// -------------------- validators --------------------
function isValidTrc20(addr) {
  const s = String(addr || "").trim();
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s);
}

function toNum(x) {
  const n = Number(String(x || "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function countDecimals(n) {
  const s = String(n);
  const i = s.indexOf(".");
  return i === -1 ? 0 : Math.min(18, s.length - i - 1);
}

/**
 * ✅ amount normalization (USDT-friendly)
 * - must be finite > 0
 * - cap max
 * - max 6 decimals
 * - normalize to 6 decimals
 */
function normalizeAmount(input) {
  const n = toNum(input);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, value: NaN, error: "Invalid amount" };
  if (n > 1_000_000) return { ok: false, value: n, error: "Invalid amount" };
  if (countDecimals(n) > 6) return { ok: false, value: n, error: "Too many decimal places" };
  return { ok: true, value: Number(n.toFixed(6)), error: null };
}

// -------------------- 2-month lock (Clamp Month Logic - UTC) --------------------
function daysInMonthUTC(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function addMonthsClampedUTC(dateLike, monthsToAdd) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;

  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();

  const targetMonth = m + Number(monthsToAdd || 0);
  const targetYear = y + Math.floor(targetMonth / 12);
  const targetMonth0 = ((targetMonth % 12) + 12) % 12;

  const dim = daysInMonthUTC(targetYear, targetMonth0);
  const clampedDay = Math.min(day, dim);

  // 12:00 UTC برای کاهش ریسک DST/offset
  return new Date(Date.UTC(targetYear, targetMonth0, clampedDay, 12, 0, 0, 0));
}

function pickFirstInvestmentApproved(orders, email) {
  const e = normalizeEmail(email);

  const list = (orders || [])
    .filter((o) => normalizeEmail(o?.userEmail) === e)
    .filter((o) => String(o?.status || "") === "Approved")
    .filter((o) => String(o?.orderType || "") === "investment");

  if (list.length === 0) return null;

  // ✅ مبنا: investmentStartedAt اگر هست، وگرنه createdAt
  const sorted = list
    .slice()
    .sort(
      (a, b) =>
        new Date(a.investmentStartedAt || a.createdAt).getTime() -
        new Date(b.investmentStartedAt || b.createdAt).getTime()
    );

  return sorted[0] || null;
}

function canWithdrawByTime(orders, email) {
  const first = pickFirstInvestmentApproved(orders, email);
  if (!first) return { ok: false, reason: "no_investment", daysLeft: null };

  const startLike = first.investmentStartedAt || first.createdAt;
  const unlock = addMonthsClampedUTC(startLike, 2);
  if (!unlock) return { ok: false, reason: "too_early", daysLeft: null };

  const diffMs = unlock.getTime() - Date.now();
  if (diffMs <= 0) return { ok: true, reason: "ok", daysLeft: 0 };

  const daysLeft = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
  return { ok: false, reason: "too_early", daysLeft };
}

// -------------------- limits --------------------
function getUserInvestedAmount(orders, email) {
  const e = normalizeEmail(email);

  const list = (orders || [])
    .filter((o) => normalizeEmail(o?.userEmail) === e)
    .filter((o) => String(o?.status || "") === "Approved")
    .filter((o) => String(o?.orderType || "") === "investment");

  return list.reduce((sum, o) => sum + Number(o?.amount || 0), 0);
}

function hasPendingWithdrawal(rows, email) {
  const e = normalizeEmail(email);
  return (rows || []).some(
    (r) => normalizeEmail(r?.email) === e && String(r?.status || "") === "pending"
  );
}

function rateLimitCheck(rows, email) {
  const e = normalizeEmail(email);
  const now = Date.now();
  const windowMs = WITHDRAW_RATE_LIMIT_WINDOW_MIN * 60 * 1000;

  const recent = (rows || []).filter((r) => {
    if (normalizeEmail(r?.email) !== e) return false;
    const t = new Date(r?.createdAt || 0).getTime();
    if (!Number.isFinite(t) || t <= 0) return false;
    return now - t <= windowMs;
  });

  if (recent.length >= WITHDRAW_RATE_LIMIT_MAX) {
    const oldest = recent
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];

    const oldestMs = new Date(oldest?.createdAt || 0).getTime();
    const retryAfterMs = Math.max(0, windowMs - (now - oldestMs));
    const retryAfterMin = Math.ceil(retryAfterMs / (60 * 1000));
    return { ok: false, retryAfterMin };
  }

  return { ok: true, retryAfterMin: 0 };
}

export default async function handler(req, res) {
  try {
    setNoStore(res);
    applySecurityHeaders(res);

    // ✅ CSRF (برای POST/PUT/PATCH/DELETE فعال است)
    if (!verifyCsrf(req)) return rejectCsrf(res);

    // ✅ (اختیاری ولی مفید) سخت‌گیری روی content-type برای کاهش درخواست‌های عجیب
    const ct = String(req.headers["content-type"] || "");
    if (ct && !ct.includes("application/json")) {
      return res.status(415).json({ ok: false, error: "Unsupported Media Type" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const session = getSession(req);
    if (!session?.email) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const email = normalizeEmail(session.email);

    // ✅ امنیت واقعی: re-check user از userStore (بدون تغییر پیام)
    const realUser = await findUserByEmail(email);
    if (!realUser) {
      auditUser(req, email, "withdrawal_request.auth_failed", false, { reason: "user_not_found" });
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    // Extra rate-limit at edge: per IP + per user (anti abuse)
    const ip = getIp(req);
    const ua = getUa(req);

    const rlIp = rateLimit(`withdraw:req:ip:${ip}`, { windowMs: 60 * 60_000, max: 20 });
    if (!rlIp.ok) {
      auditUser(req, email, "withdrawal_request.blocked", false, {
        reason: "edge_rl_ip",
        meta: { resetAt: rlIp.resetAt },
      });
      return res.status(429).json({
        ok: false,
        error: "Too many requests. Try again later.",
        resetAt: rlIp.resetAt,
      });
    }

    const rlUser = rateLimit(`withdraw:req:user:${email}`, { windowMs: 60 * 60_000, max: 5 });
    if (!rlUser.ok) {
      auditUser(req, email, "withdrawal_request.blocked", false, {
        reason: "edge_rl_user",
        meta: { resetAt: rlUser.resetAt },
      });
      return res.status(429).json({
        ok: false,
        error: "Too many requests. Try again later.",
        resetAt: rlUser.resetAt,
      });
    }

    const { amount, walletAddress } = req.body || {};
    const amtNorm = normalizeAmount(amount);
    const addr = String(walletAddress || "").trim();

    if (!amtNorm.ok) {
      auditUser(req, email, "withdrawal_request.rejected", false, {
        reason: "invalid_amount",
        meta: { error: amtNorm.error },
      });
      return res.status(400).json({ ok: false, error: amtNorm.error || "Invalid amount" });
    }

    const amt = amtNorm.value;

    if (!isValidTrc20(addr)) {
      auditUser(req, email, "withdrawal_request.rejected", false, {
        reason: "invalid_wallet",
        meta: { walletMasked: maskWallet(addr) },
      });
      return res.status(400).json({ ok: false, error: "Invalid USDT TRC20 address" });
    }

    const orders = await readOrders();

    // ✅ 2-month server-side lock (Clamp UTC)
    const rule = canWithdrawByTime(orders, email);
    if (!rule.ok) {
      appendWithdrawalsAudit(
        {
          type: "withdrawal_request_blocked",
          reason: rule.reason,
          daysLeft: rule.daysLeft ?? null,
          at: new Date().toISOString(),
          email,
          ip: ip || "unknown",
          ua: clampLen(cleanNoCrlf(ua), 300),
          amount: amt,
          walletMasked: maskWallet(addr),
        },
        { awaitWrite: false }
      );

      auditUser(req, email, "withdrawal_request.blocked", false, {
        reason: rule.reason,
        meta: { daysLeft: rule.daysLeft ?? null, amount: amt, walletMasked: maskWallet(addr) },
      });

      if (rule.reason === "no_investment") {
        return res.status(403).json({ ok: false, error: "No approved investment found." });
      }

      return res.status(403).json({
        ok: false,
        error: `Withdrawal is available after 2 months from investment start. Days left: ${rule.daysLeft ?? "-"}`,
        daysLeft: rule.daysLeft ?? null,
      });
    }

    // ✅ Critical section: multi-process safe via store lock
    const result = await withWithdrawalsLock(async () => {
      const rows = await readWithdrawals();

      if (hasPendingWithdrawal(rows, email)) {
        appendWithdrawalsAudit(
          {
            type: "withdrawal_request_blocked",
            reason: "pending_exists",
            at: new Date().toISOString(),
            email,
            ip: ip || "unknown",
            ua: clampLen(cleanNoCrlf(ua), 300),
            amount: amt,
            walletMasked: maskWallet(addr),
          },
          { awaitWrite: false }
        );

        auditUser(req, email, "withdrawal_request.blocked", false, {
          reason: "pending_exists",
          meta: { amount: amt, walletMasked: maskWallet(addr) },
        });

        return {
          ok: false,
          status: 409,
          body: {
            ok: false,
            error: "You already have a pending withdrawal request. Please wait for it to be processed.",
          },
        };
      }

      const rl = rateLimitCheck(rows, email);
      if (!rl.ok) {
        appendWithdrawalsAudit(
          {
            type: "withdrawal_request_blocked",
            reason: "rate_limited",
            retryAfterMin: rl.retryAfterMin,
            at: new Date().toISOString(),
            email,
            ip: ip || "unknown",
            ua: clampLen(cleanNoCrlf(ua), 300),
            amount: amt,
            walletMasked: maskWallet(addr),
          },
          { awaitWrite: false }
        );

        auditUser(req, email, "withdrawal_request.blocked", false, {
          reason: "business_rate_limited",
          meta: { retryAfterMin: rl.retryAfterMin },
        });

        return {
          ok: false,
          status: 429,
          body: {
            ok: false,
            error: `Too many withdrawal requests. Please try again in ${rl.retryAfterMin} minutes.`,
            retryAfterMin: rl.retryAfterMin,
          },
        };
      }

      const investedTotal = getUserInvestedAmount(orders, email);
      if (Number.isFinite(investedTotal) && investedTotal > 0 && amt > investedTotal) {
        appendWithdrawalsAudit(
          {
            type: "withdrawal_request_blocked",
            reason: "amount_exceeds_capital",
            at: new Date().toISOString(),
            email,
            ip: ip || "unknown",
            ua: clampLen(cleanNoCrlf(ua), 300),
            amount: amt,
            investedTotal,
            walletMasked: maskWallet(addr),
          },
          { awaitWrite: false }
        );

        auditUser(req, email, "withdrawal_request.rejected", false, {
          reason: "amount_exceeds_capital",
          meta: { amount: amt, investedTotal },
        });

        return {
          ok: false,
          status: 400,
          body: { ok: false, error: "Amount exceeds your invested capital." },
        };
      }

      const requestId = safeId();
      const createdAt = new Date().toISOString();

      const item = {
        id: requestId,
        email,
        amount: amt,
        walletAddress: addr,
        status: "pending", // pending | approved | rejected
        adminNote: "",
        createdAt,
        updatedAt: createdAt,
        ip: ip || "unknown",
        ua: clampLen(cleanNoCrlf(ua), 300),
      };

      rows.unshift(item);
      await writeWithdrawals(rows);

      appendWithdrawalsAudit(
        {
          type: "withdrawal_request_created",
          at: createdAt,
          email: item.email,
          ip: item.ip,
          ua: item.ua,
          amount: item.amount,
          walletMasked: maskWallet(item.walletAddress),
          requestId: item.id,
        },
        { awaitWrite: false }
      );

      auditUser(req, email, "withdrawal_request.created", true, {
        targetId: item.id,
        meta: { amount: item.amount, walletMasked: maskWallet(item.walletAddress) },
      });

      return { ok: true, status: 200, body: { ok: true, request: item } };
    });

    // Send email after write (non-blocking for persistence)
    if (result?.ok && result?.body?.ok && result?.body?.request) {
      const item = result.body.request;
      sendWithdrawalRequestReceivedEmail({
        to: item.email,
        amount: item.amount,
        walletAddress: item.walletAddress,
        atIso: item.createdAt,
        ip: item.ip,
        ua: item.ua,
      }).catch(() => {});
    }

    return res.status(result.status).json(result.body);
  } catch (e) {
    console.error("withdrawals/request error:", e);

    appendWithdrawalsAudit(
      {
        type: "withdrawal_request_error",
        at: new Date().toISOString(),
        message: String(e?.message || e),
      },
      { awaitWrite: false }
    );

    // audit عمومی هم (best-effort، بدون داده حساس)
    try {
      appendAuditEvent(
        makeAuditEvent({
          actor: { type: "system", id: "withdrawal_request" },
          action: "withdrawal_request.error",
          target: { type: "withdrawal_request", id: null },
          ok: false,
          reason: String(e?.message || e),
        })
      );
    } catch {}
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

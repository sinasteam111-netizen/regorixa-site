// pages/api/auth/orders/my.js
import { getSession } from "../../../../lib/auth";
import { getOrdersByEmail } from "../../../../lib/orderstore";
import { rateLimit } from "../../../../lib/rateLimit";
import { getIp } from "../../../../lib/ipUa";
import { findUserByEmail } from "../../../../lib/userStore";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function sl(x) {
  return String(x ?? "").trim().toLowerCase();
}

function asTime(v) {
  const t = Date.parse(v || 0);
  return Number.isFinite(t) ? t : 0;
}

export default async function handler(req, res) {
  try {
    noStore(res);

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ rate limit سبک برای read
try {
  const ip = getIp(req);
  const p = String(req?.url || "").split("?")[0] || "";

  const isProd = process.env.NODE_ENV === "production";

  // در dev سخت‌گیری نکن (به خاطر StrictMode و re-render)
  const rl = rateLimit(`user:orders:my:${ip}:${p}`, {
    windowMs: 60 * 1000,
    max: isProd ? 60 : 600, // ✅ dev: 600/min ، prod: 60/min
  });

  if (!rl.ok) {
    return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
  }
} catch {}

    // ✅ session (sync/async-safe)
    const session = await Promise.resolve(getSession(req));
    if (!session) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const email = sl(session.email || session.user?.email || "");
    if (!email) {
      return res.status(401).json({ ok: false, error: "Not authenticated (email missing)" });
    }

    // ✅ امنیت واقعی (non-breaking):
    // اگر user پیدا شد و userId mismatch بود → 401
    // اگر user پیدا نشد یا خطا شد → fail-open (همون رفتار قبلی)
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
    } catch {
      // fail-open
    }

    const orders = await getOrdersByEmail(email);
    const list = Array.isArray(orders) ? orders : [];

    // ✅ فقط Approved ها برای active انتخاب می‌شن (هم status هم statusText)
    const approved = list.filter((o) => {
      const st = sl(o?.status || o?.statusText);
      return st === "approved";
    });

    // مرتب‌سازی کلی جدیدترها اول
    const byUpdatedDesc = (a, b) => {
      const ta = asTime(a?.updatedAt || a?.createdAt);
      const tb = asTime(b?.updatedAt || b?.createdAt);
      return tb - ta;
    };

    // activePlan: آخرین plan Approved
    const activePlan =
      approved
        .filter((o) => sl(o?.orderType) === "plan")
        .sort(byUpdatedDesc)[0] || null;

    // activeInvestment: آخرین investment Approved (مبنای زمان: investmentStartedAt اگر هست)
    const activeInvestment =
      approved
        .filter((o) => sl(o?.orderType) === "investment")
        .sort((a, b) => {
          const ta = asTime(a?.investmentStartedAt || a?.updatedAt || a?.createdAt);
          const tb = asTime(b?.investmentStartedAt || b?.updatedAt || b?.createdAt);
          return tb - ta;
        })[0] || null;

    return res.status(200).json({
      ok: true,
      orders: list,
      activePlan,
      activeInvestment,
    });
  } catch (e) {
    console.error("api/auth/orders/my error:", e);
    return res.status(500).json({
      ok: false,
      error: "Server error",
      detail: String(e?.message || e),
    });
  }
}
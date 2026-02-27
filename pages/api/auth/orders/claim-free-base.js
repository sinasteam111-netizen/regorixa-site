import { getSession } from "../../../../lib/auth";
import { getOrdersByEmail } from "../../../../lib/orderstore";
import { readUsers, writeUsers } from "../../../../lib/userStore";
import { rateLimit } from "../../../../lib/rateLimit";
import { getIp } from "../../../../lib/ipUa";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function isRejectedOrCancelled(status, statusText) {
  const s1 = String(status || "").toLowerCase();
  const s2 = String(statusText || "").toLowerCase();
  const s = `${s1} ${s2}`.trim();
  return s.includes("rejected") || s.includes("reject") || s.includes("cancel");
}

export default async function handler(req, res) {
  try {
    noStore(res);

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ Rate limit حساس (claim write)
    // fail-open برای حفظ رفتار اگر limiter مشکل داشت
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const key = `user:claim-free-base:${ip}:${p}`;
      const rl = rateLimit(key, { windowMs: 5 * 60 * 1000, max: 10 }); // 10 per 5min per IP
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {}

    const session = await Promise.resolve(getSession(req));
    if (!session) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const email = String(session.email || session.user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ ok: false, error: "Not authenticated (email missing)" });

    // ✅ شرط اصلی شما:
    // FREE فقط تا قبل از اولین سرمایه‌گذاری (orderType=investment) حتی اگر Pending باشد
    const myOrders = await getOrdersByEmail(email);

    const hasAnyInvestment = (Array.isArray(myOrders) ? myOrders : []).some((o) => {
      const amount = Number(o?.amount || 0);
      const type = String(o?.orderType || "").toLowerCase();
      const status = String(o?.status || "");
      const statusText = String(o?.statusText || "");

      if (type !== "investment") return false;
      if (!(amount > 0)) return false;

      // اگر رد/کنسل شده بود، سرمایه‌گذاری حساب نکن
      if (isRejectedOrCancelled(status, statusText)) return false;

      // Pending / Verification / Approved / ... همه یعنی سرمایه‌گذاری شروع شده
      return true;
    });

    if (hasAnyInvestment) {
      return res.status(403).json({
        ok: false,
        error: "Free option is only available before your first investment.",
      });
    }

    // ✅ Order ساخته نمی‌شود. فقط برای ردیابی/کنترل، فلگ روی user ذخیره می‌کنیم.
    const usersRaw = await readUsers();
    const users = Array.isArray(usersRaw) ? usersRaw : [];

    const now = new Date().toISOString();
    const idx = users.findIndex((u) => String(u?.email || "").toLowerCase() === email);

    if (idx >= 0) {
      users[idx] = {
        ...users[idx],
        freeBaseAllowed: true,         // اختیاری: یعنی مجاز بوده وارد free بشه
        freeBaseAllowedAt: now,
        updatedAt: now,
      };
    } else {
      users.push({
        email,
        freeBaseAllowed: true,
        freeBaseAllowedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    await writeUsers(users);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("claim-free-base error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
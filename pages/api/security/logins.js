import { readUsers } from "../../../lib/userStore";
import { getSession } from "../../../lib/auth";
import { requireAdmin } from "../../../lib/requireAdmin";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp } from "../../../lib/ipUa";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

export default async function handler(req, res) {
  try {
    noStore(res);

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ rate limit سبک (read حساس)
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`securitylog:get:${ip}:${p}`, { windowMs: 60 * 1000, max: 60 });
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {}

    const session = getSession(req);
    if (!session?.email) {
      // پیام‌های قبلی رو حفظ می‌کنیم: قبلاً 400 Missing email بود اگر query نبود.
      // ولی برای امنیت واقعی، بدون session اصلاً اجازه نمی‌دیم.
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const sessionEmail = String(session.email || "").trim().toLowerCase();
    const requestedEmail = String(req.query?.email || "").trim().toLowerCase();

    // ✅ اگر admin بود، می‌تونه برای email دلخواه هم بخونه.
    // اگر admin نبود، فقط ایمیل خودش (و اگر email در query نبود، همون ایمیل خودش)
    let targetEmail = requestedEmail || sessionEmail;

    const isSelf = targetEmail === sessionEmail;

    if (!isSelf) {
      // باید admin واقعی باشد
      const auth = await requireAdmin(req, res, {
        rateLimitKeyPrefix: "admin:securitylog:get",
        setNoStoreHeader: true,
      });
      if (!auth) return;
    }

    if (!targetEmail) return res.status(400).json({ ok: false, error: "Missing email" });

    const usersRaw = await readUsers();
    const users = Array.isArray(usersRaw) ? usersRaw : [];

    const u = users.find((x) => String(x?.email || "").trim().toLowerCase() === targetEmail);
    if (!u) return res.status(404).json({ ok: false, error: "User not found" });

    return res.json({
      ok: true,
      log: Array.isArray(u.securityLog) ? u.securityLog : [],
    });
  } catch (e) {
    console.error("security log error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

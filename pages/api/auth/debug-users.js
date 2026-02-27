import { readUsers } from "../../../lib/userStore";
import { requireAdmin } from "../../../lib/requireAdmin";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp } from "../../../lib/ipUa";
import { applySecurityHeaders } from "../../../lib/securityHeaders";

function noStore(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

export default async function handler(req, res) {
  try {
    noStore(res);
    applySecurityHeaders(res);

    // ✅ Fail-closed flag (اختیاری ولی عالی برای اینکه اشتباهی فعال نشه)
    if (String(process.env.ENABLE_DEBUG_ENDPOINTS || "").toLowerCase() !== "true") {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    // ✅ DEV-ONLY (debug/high-risk: list all emails)
    if (process.env.NODE_ENV !== "development") {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ rate limit سبک (admin read)
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`admin:users:emails:${ip}:${p}`, {
        windowMs: 60 * 1000,
        max: 30, // 30/min
      });
      if (!rl.ok) {
        return res.status(429).json({
          ok: false,
          error: "Too many requests",
          resetAt: rl.resetAt,
        });
      }
    } catch {}

    // ✅ امنیت واقعی: فقط admin + user واقعی
    const auth = await requireAdmin(req, res, {
      rateLimitKeyPrefix: "admin:users:emails",
      setNoStoreHeader: true,
    });
    if (!auth) return;

    const users = await readUsers();
    const list = Array.isArray(users) ? users : [];

    return res.status(200).json({
      ok: true,
      count: list.length,
      emails: list.map((u) => u.email),
    });
  } catch (e) {
    if (res.headersSent) return;
    console.error("list-users-emails error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

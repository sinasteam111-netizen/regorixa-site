import { requireAdmin } from "../../../lib/requireAdmin";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp } from "../../../lib/ipUa";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function isEmail(s) {
  const v = String(s || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default async function handler(req, res) {
  try {
    noStore(res);

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ rate limit سخت (چون اگر لو بره فاجعه می‌شه)
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`admin:debug-email:${ip}:${p}`, { windowMs: 60 * 1000, max: 10 });
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {
      // fail-closed برای چنین endpointی بهتره
      return res.status(429).json({ ok: false, error: "Too many requests" });
    }

    // ✅ امنیت واقعی: فقط admin
    const auth = await requireAdmin(req, res, {
      rateLimitKeyPrefix: "admin:debug-email",
      setNoStoreHeader: true,
    });
    if (!auth) return;

    const { to, subject, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ ok: false });

    // ✅ sanity بدون تغییر رفتار موفق/ناموفق
    const toNorm = String(to).trim().slice(0, 200);
    const subjectNorm = String(subject || "").trim().slice(0, 200);
    const textNorm = String(text).trim().slice(0, 5000); // جلوگیری از DoS

    // اگر ایمیل نیست، همون ok:false (بدون پیام جدید)
    if (!isEmail(toNorm)) return res.status(400).json({ ok: false });

    // فعلاً لاگ می‌کنیم (برای production SMTP وصل میشه)
    console.log("📧 EMAIL");
    console.log("To:", toNorm);
    console.log("Subject:", subjectNorm);
    console.log("Text:", textNorm);

    return res.json({ ok: true });
  } catch (e) {
    console.error("debug-email error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

import { rateLimit } from "../../../lib/rateLimit";
import { getIp } from "../../../lib/ipUa";
import { verifyCsrf, rejectCsrf } from "../../../lib/csrf";
import { applySecurityHeaders } from "../../../lib/securityHeaders";
import { appendSetCookie } from "../../../lib/cookieUtils";

const SESS_KEY = "__REGORIXA_SESSIONS__";
const COOKIE_NAME = "regorixa_session";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function getCookieValue(req, name) {
  const cookie = String(req.headers.cookie || "");
  if (!cookie) return "";

  // split safe-ish: "a=b; c=d"
  const parts = cookie.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) {
      const v = p.slice(prefix.length);
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return "";
}

export default function handler(req, res) {
  try {
    noStore(res);
    applySecurityHeaders(res);

    if (req.method !== "POST") return res.status(405).end();

    // ✅ CSRF (logout state-changing است)
    if (!verifyCsrf(req)) return rejectCsrf(res);

    // ✅ optional: content-type hardening
    const ct = String(req.headers["content-type"] || "");
    if (ct && !ct.includes("application/json")) {
      return res.status(415).json({ ok: false, error: "Unsupported Media Type" });
    }

    // rate limit سبک
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`auth:logout:${ip}:${p}`, { windowMs: 60 * 1000, max: 60 });
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {
      // fail-open برای حفظ رفتار
    }

    // اگر session-map وجود دارد، کلید را امن استخراج کن و delete کن
    if (globalThis[SESS_KEY]) {
      const raw = getCookieValue(req, COOKIE_NAME);
      if (raw) {
        // همون منطق قبلی: قبل از '.' (مثلاً sessionId.sig)
        const key = String(raw).split(".")[0];
        try {
          globalThis[SESS_KEY].delete(key);
        } catch {}
      }
    }

    // Secure را مطابق محیط تنظیم کن تا logout در dev هم واقعاً کار کند
    const isProd = process.env.NODE_ENV === "production";
    const secureAttr = isProd ? " Secure;" : "";

    // ✅ append cookie (نه overwrite)
    appendSetCookie(
      res,
      `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax;${secureAttr}`
    );

    return res.json({ ok: true });
  } catch (e) {
    // خروجی ok:true را تغییر نمی‌دیم اگر قبلاً هم همیشه ok می‌داد؛
    // ولی اینجا اگر خطای غیرمنتظره شد، حداقل 500 بدهیم.
    console.error("logout error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

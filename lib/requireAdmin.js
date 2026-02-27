// lib/requireAdmin.js
import { getSession } from "./auth";
import { findUserByEmail } from "./userStore";
import { rateLimit } from "./rateLimit";
import { getIp, getUa } from "./ipUa";

function setNoStore(res) {
  if (!res?.setHeader) return;
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function safeLower(x) {
  return String(x || "").trim().toLowerCase();
}

/**
 * requireAdmin(req, res, options?)
 * - check session
 * - check real user from store
 * - check role
 * - returns { user, session } or sends 401/403/429 and returns null
 */
export async function requireAdmin(req, res, options = {}) {
  const {
    allowRoles = ["admin", "super_admin"],
    rateLimitKeyPrefix = "admin",
    rateLimitWindowMs = 60 * 1000,
    rateLimitMax = 60,
    setNoStoreHeader = true,
  } = options;

  try {
    if (setNoStoreHeader) setNoStore(res);

    // Basic rate limit (IP + path)
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const key = `${rateLimitKeyPrefix}:${ip}:${p}`;
      const rl = rateLimit(key, { windowMs: rateLimitWindowMs, max: rateLimitMax });

      if (!rl.ok) {
        if (!res.headersSent) {
          res.status(429).json({
            ok: false,
            error: "Too many requests",
            resetAt: rl.resetAt,
          });
        }
        return null;
      }
    } catch {
      // fail-open (مثل نسخه خودت)
    }

    // ✅ session (sync or async)
    const session = await Promise.resolve(getSession(req));
    const email = safeLower(session?.email || session?.user?.email || "");
    if (!email) {
      if (!res.headersSent) res.status(401).json({ ok: false, error: "Not authenticated" });
      return null;
    }

    const user = await findUserByEmail(email);
    if (!user?.email) {
      if (!res.headersSent) res.status(401).json({ ok: false, error: "Not authenticated" });
      return null;
    }

    // Optional sanity check: session.userId matches user.id
    if (session?.userId != null && user?.id != null) {
      const sid = String(session.userId);
      const uid = String(user.id);
      if (sid && uid && sid !== uid) {
        if (!res.headersSent) res.status(401).json({ ok: false, error: "Not authenticated" });
        return null;
      }
    }

    const role = safeLower(user.role || "user");
    const allowed = Array.isArray(allowRoles)
      ? allowRoles.map((r) => safeLower(r))
      : ["admin", "super_admin"];

    if (!allowed.includes(role)) {
      if (!res.headersSent) res.status(403).json({ ok: false, error: "Forbidden" });
      return null;
    }

    // (اختیاری) این اطلاعات رو برمی‌گردونیم اگر جای دیگه لازم شد برای audit
    const ua = getUa ? getUa(req) : (req.headers["user-agent"] || null);
    const ip = getIp(req) || null;

    return { user, session, ip, ua };
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: "Server error" });
    return null;
  }
}
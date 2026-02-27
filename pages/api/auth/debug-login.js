import bcrypt from "bcryptjs";
import { findUserByEmail } from "../../../lib/userStore";
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
    // فقط وقتی خودت صریح ENABLE_DEBUG_ENDPOINTS=true گذاشتی باز میشه.
    if (String(process.env.ENABLE_DEBUG_ENDPOINTS || "").toLowerCase() !== "true") {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    // ✅ DEV-ONLY (endpoint فوق‌العاده خطرناک)
    if (process.env.NODE_ENV !== "development") {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ Rate limit سخت برای جلوگیری از abuse (fail-closed)
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`debug:check-pass:${ip}:${p}`, {
        windowMs: 60 * 1000,
        max: 10, // 10/min/IP
      });
      if (!rl.ok) {
        return res.status(429).json({
          ok: false,
          error: "Too many requests",
          resetAt: rl.resetAt,
        });
      }
    } catch (e) {
      return res.status(429).json({ ok: false, error: "Too many requests" });
    }

    // ✅ حتی در dev هم فقط ادمین
    const auth = await requireAdmin(req, res, {
      rateLimitKeyPrefix: "admin:debug:check-pass",
      setNoStoreHeader: true,
    });
    if (!auth) return;

    const { email, password } = req.body || {};
    const emailNorm = String(email || "").trim().toLowerCase();
    const pass = String(password || "");

    const user = await findUserByEmail(emailNorm);

    if (!user) {
      return res.status(200).json({ ok: true, userFound: false });
    }

    const hasHash = !!user.passwordHash && String(user.passwordHash).length > 20;
    let match = false;

    if (hasHash) {
      try {
        match = await bcrypt.compare(pass, user.passwordHash);
      } catch {
        match = false;
      }
    }

    return res.status(200).json({
      ok: true,
      userFound: true,
      hasHash,
      match,
      // برای دیباگ فقط طول هش، نه خود هش
      hashLen: user.passwordHash ? String(user.passwordHash).length : 0,
    });
  } catch (e) {
    console.error("check-pass error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

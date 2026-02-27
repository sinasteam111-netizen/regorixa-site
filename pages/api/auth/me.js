// pages/api/auth/me.js
import { getSession } from "@/lib/auth";
import { findUserByEmail } from "@/lib/userStore";

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  try {
    // Only allow GET
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    }

    // Prevent caching (important for auth/role)
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const session = getSession(req);
    const email = normEmail(session?.email);

    if (!email) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const user = await findUserByEmail(email);
    if (!user?.email) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    // ✅ Backup codes counters (safe)
    const recoveryCodes = Array.isArray(user.recoveryCodes) ? user.recoveryCodes : [];
    const recoveryCodesTotal = recoveryCodes.length;
    const recoveryCodesRemaining = recoveryCodes.filter((c) => c && !c.usedAt).length;

    // IMPORTANT: do not trust role from session; use role from user record
    const role = String(user.role || "user").toLowerCase() || "user";

    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        birthDate: user.birthDate || "",
        phone: user.phone || "",
        email: user.email,
        createdAt: user.createdAt,

        // اگر واقعاً verify داری از دیتا بخون، اگر نه همین true بمونه
        emailVerified: user.emailVerified !== undefined ? !!user.emailVerified : true,

        role,

        // ✅ 2FA
        twoFactorEnabled: !!user.twoFactorEnabled,

        // ✅ Backup codes info (used in Security page)
        recoveryCodesTotal,
        recoveryCodesRemaining,
      },
    });
  } catch (e) {
    console.error("auth/me error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

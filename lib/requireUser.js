// lib/requireUser.js
import { getSession } from "./auth";
import { findUserByEmail } from "./userStore";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * requireUser:
 * - session را می‌خواند
 * - email را normalize می‌کند
 * - user واقعی را از userStore برمی‌دارد
 *
 * خروجی:
 * { session, user, email } یا null
 *
 * نکته: این helper response نمی‌دهد تا endpoint output تغییر نکند.
 */
export async function requireUser(req) {
  const session = getSession(req);
  if (!session) return null;

  const email = normalizeEmail(session.email);
  if (!email) return null;

  // ✅ امنیت واقعی: user واقعی از store
  const user = await findUserByEmail(email);
  if (!user) return null;

  return { session, user, email };
}

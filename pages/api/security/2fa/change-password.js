import bcrypt from "bcryptjs";
import { readUsers, writeUsers } from "../../../../lib/userStore";
import { sendPasswordChangedEmail } from "../../../../lib/mailer";
import { getIp, getUa } from "../../../../lib/requestMeta";
import { rateLimit } from "../../../../lib/rateLimit";
import { getSession } from "../../../../lib/auth";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function normEmail(x) {
  return String(x || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  try {
    noStore(res);

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const ip =
      (req.headers["x-forwarded-for"]?.toString().split(",")[0] || "").trim() ||
      req.socket?.remoteAddress ||
      "unknown";

    // ✅ rate limit IP
    const rl = rateLimit(`change-pass:ip:${ip}`, { windowMs: 15 * 60_000, max: 5 });
    if (!rl.ok) {
      return res.status(429).json({
        ok: false,
        error: "Too many attempts. Please try again later.",
      });
    }

    const { email, currentPassword, newPassword } = req.body || {};

    let e = normEmail(email);
    const cur = String(currentPassword || "");
    const next = String(newPassword || "");

    // ✅ prefer session email (body cannot switch target)
    try {
      const session = getSession(req);
      const sessEmail = normEmail(session?.email || session?.user?.email);
      if (sessEmail) e = sessEmail;
    } catch {}

    if (!e || !cur || !next) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    if (next.length < 8) {
      return res.status(400).json({
        ok: false,
        error: "Password must be at least 8 characters",
      });
    }

    // ✅ anti-DoS bcrypt
    if (next.length > 200) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    // ✅ rate limit per email
    try {
      const rlEmail = rateLimit(`change-pass:email:${e || "_"}`, { windowMs: 15 * 60_000, max: 5 });
      if (!rlEmail.ok) {
        return res.status(429).json({
          ok: false,
          error: "Too many attempts. Please try again later.",
        });
      }
    } catch {}

    const usersRaw = await readUsers();
    const users = Array.isArray(usersRaw) ? usersRaw : [];

    const idx = users.findIndex((u) => normEmail(u?.email) === e);
    if (idx === -1) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const u = users[idx];

    // ✅ supports old + new storage keys
    const storedHash =
      u.passwordHash ||
      u.password ||
      u.hash ||
      u.password_hash ||
      u.passHash ||
      "";

    if (!storedHash) {
      // اگر کاربر رکورد خراب داشت
      return res.status(400).json({ ok: false, error: "Current password is incorrect" });
    }

    const ok = await bcrypt.compare(cur, String(storedHash));
    if (!ok) {
      return res.status(400).json({ ok: false, error: "Current password is incorrect" });
    }

    // ✅ set new hash (canonical key)
    u.passwordHash = await bcrypt.hash(next, 12);
    u.passwordChangedAt = new Date().toISOString();
    u.passwordChangedBy = "change_password";

    // (اختیاری) اگر قبلاً password ذخیره می‌کردی، پاکش نکنیم چون گفتی حذف نکنم
    // اما برای سازگاری بهتر می‌تونیم همزمان sync کنیم:
    // u.password = u.passwordHash;

    users[idx] = u;

    await writeUsers(users);

    // 🔐 notify user (password changed)
    try {
      const ua = getUa(req);
      await sendPasswordChangedEmail({
        to: e,
        ip,
        ua,
        atIso: new Date().toISOString(),
      });
    } catch {}

    return res.json({ ok: true });
  } catch (err) {
    console.error("change-password error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
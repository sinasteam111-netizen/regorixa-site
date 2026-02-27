import crypto from "crypto";
import { readUsers, writeUsers } from "../../../lib/userStore";
import { Resend } from "resend";
import { getPublicBaseUrl } from "../../../lib/baseUrl";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp, getUa } from "../../../lib/ipUa";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

// ✅ قوی‌تر از Math.random
function genOtp6() {
  return String(crypto.randomInt(100000, 1000000));
}

export default async function handler(req, res) {
  try {
    noStore(res);

    console.log("request-reset-otp HIT", new Date().toISOString());

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const ip = getIp(req);
    const ua = getUa(req); // برای audit آینده (خروجی تغییر نمی‌کنه)

    // ✅ Rate limit ضد abuse (IP + endpoint)
    // چون endpoint حساسه، بهتره fail-closed باشه
    try {
      const p = String(req?.url || "").split("?")[0] || "";
      const rlIp = rateLimit(`resetotp:ip:${ip}:${p}`, { windowMs: 15 * 60_000, max: 10 }); // 10 per 15min
      if (!rlIp.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rlIp.resetAt });
      }
    } catch {
      return res.status(429).json({ ok: false, error: "Too many requests" });
    }

    const { email } = req.body || {};
    const e = String(email || "").trim().toLowerCase();
    if (!e) return res.status(400).json({ ok: false, error: "Email required" });

    // ✅ Rate limit per email هم اضافه کن (ضد email bombing)
    // (برای ایمیل خالی/بد، key متفاوت)
    try {
      const rlEmail = rateLimit(`resetotp:email:${e || "_"}`, { windowMs: 15 * 60_000, max: 3 }); // 3 per 15min
      if (!rlEmail.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rlEmail.resetAt });
      }
    } catch {
      return res.status(429).json({ ok: false, error: "Too many requests" });
    }

    const usersRaw = await readUsers();
    const users = Array.isArray(usersRaw) ? usersRaw : [];
    const idx = users.findIndex((u) => String(u?.email || "").trim().toLowerCase() === e);

    // ✅ ضد enumeration: مثل قبل، اگر کاربر نبود هم ok:true
    if (idx === -1) return res.json({ ok: true });

    const otp = genOtp6();
    const expiresAtISO = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // ✅ فقط hash ذخیره می‌کنیم (مثل قبل)
    users[idx].resetOtpHash = sha256(otp);
    users[idx].resetOtpExpiresAt = expiresAtISO;

    // Optional audit fields (بدون اینکه خروجی تغییر کنه)
    users[idx].resetOtpLastIp = ip;
    users[idx].resetOtpLastUa = ua;
    users[idx].resetOtpRequestedAt = new Date().toISOString();

    // ✅ write باید lock+atomic باشد (داخل userStore ایده‌آل است)
    await writeUsers(users);

    const resendKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;

    if (!resendKey || !from) {
      console.error("Missing RESEND_API_KEY or EMAIL_FROM");
      return res.status(500).json({ ok: false, error: "Email not configured" });
    }

    const resend = new Resend(resendKey);

    const baseUrl = getPublicBaseUrl(req);
    const resetUrl = `${baseUrl}/forget`;
    const securityUrl = `${baseUrl}/security`;

    const r = await resend.emails.send({
      from,
      to: e,
      subject: "Password reset code",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6">
          <h2>Reset code</h2>
          <p>Your code is:</p>
          <div style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</div>
          <p>This code expires in 10 minutes.</p>
          <div style="margin-top:14px">
            <a href="${resetUrl}" style="color:#0b57d0;text-decoration:none">Open reset page</a>
            <span style="color:#aaa"> • </span>
            <a href="${securityUrl}" style="color:#0b57d0;text-decoration:none">Security</a>
          </div>
        </div>
      `,
    });

    console.log("Resend response:", r);
    return res.json({ ok: true });
  } catch (err) {
    console.error("request-reset-otp error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

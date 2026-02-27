import { Resend } from "resend";
import { getPublicBaseUrl } from "./baseUrl";

let _resendClient = null;

export function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Missing RESEND_API_KEY");
  if (_resendClient) return _resendClient;
  _resendClient = new Resend(key);
  return _resendClient;
}

function stripCrlf(s) {
  // Prevent email header injection: block CRLF
  return String(s || "").replace(/[\r\n]+/g, " ").trim();
}

function clampLen(s, max = 300) {
  const v = String(s || "");
  return v.length > max ? v.slice(0, max) + "…" : v;
}

function safeEmail(to) {
  // Minimal sanitation (don't over-validate; Resend will validate too)
  const v = stripCrlf(to);
  // If empty after sanitation, keep as is (will fail loudly)
  return v;
}

function safeFrom(from) {
  // "Name <email@domain>" is allowed — just strip CRLF
  return stripCrlf(from);
}

function safeIp(ip) {
  return clampLen(stripCrlf(ip || "unknown"), 80);
}

function safeUa(ua) {
  return clampLen(stripCrlf(ua || "unknown"), 400);
}

function safeTextField(v, max = 600) {
  return clampLen(stripCrlf(v || ""), max);
}

function joinUrl(base, path) {
  const b = String(base || "").replace(/\/+$/, "");
  const p = String(path || "").startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

function formatTime(atIso) {
  try {
    return atIso ? new Date(atIso).toLocaleString() : new Date().toLocaleString();
  } catch {
    return new Date().toLocaleString();
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// NOTE: I kept your function signatures compatible.
// You can optionally pass { req } to get correct base URL behind proxies.

export async function sendLoginAlertEmail({ to, ip, ua, atIso, req } = {}) {
  const resend = getResend();
  const from = safeFrom(process.env.EMAIL_FROM || "REGORIXA <noreply@regorixa.com>");

  const at = formatTime(atIso);
  const safeIpVal = safeIp(ip);
  const safeUaVal = safeUa(ua);

  const baseUrl = getPublicBaseUrl(req);
  const securityUrl = joinUrl(baseUrl, "/account/security");
  const resetUrl = joinUrl(baseUrl, "/reset-password");

  const subject = "New login to your REGORIXA account";

  const html = `
  <div style="font-family:Arial,sans-serif;line-height:1.6">
    <h2>New login detected</h2>
    <ul>
      <li><b>Time:</b> ${escapeHtml(at)}</li>
      <li><b>IP:</b> ${escapeHtml(safeIpVal)}</li>
      <li><b>Device:</b> ${escapeHtml(safeUaVal)}</li>
    </ul>
    <p>If this wasn’t you, secure your account immediately.</p>
    <p>
      <a href="${securityUrl}">Security settings</a> •
      <a href="${resetUrl}">Reset password</a>
    </p>
    <p style="color:#666;font-size:12px">REGORIXA Security</p>
  </div>
  `;

  const text = `New login detected
Time: ${at}
IP: ${safeIpVal}
Device: ${safeUaVal}

Security: ${securityUrl}
Reset password: ${resetUrl}`;

  await resend.emails.send({
    from,
    to: safeEmail(to),
    subject,
    html,
    text,
  });
}

// 🔐 Security email: password changed
export async function sendPasswordChangedEmail({ to, ip, ua, atIso } = {}) {
  const resend = getResend();
  const from = safeFrom(process.env.EMAIL_FROM || "REGORIXA <noreply@regorixa.com>");

  const at = formatTime(atIso);
  const safeIpVal = safeIp(ip);
  const safeUaVal = safeUa(ua);

  const subject = "Your REGORIXA password was changed";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6">
      <h2>Password changed</h2>
      <p>Your account password was changed successfully.</p>
      <ul>
        <li><b>Time:</b> ${escapeHtml(at)}</li>
        <li><b>IP:</b> ${escapeHtml(safeIpVal)}</li>
        <li><b>Device:</b> ${escapeHtml(safeUaVal)}</li>
      </ul>
      <p>If this wasn’t you, please reset your password immediately.</p>
      <p style="color:#666;font-size:12px">REGORIXA Security</p>
    </div>
  `;

  const text = `Password changed
Time: ${at}
IP: ${safeIpVal}
Device: ${safeUaVal}

If this wasn't you, reset your password immediately.`;

  await resend.emails.send({
    from,
    to: safeEmail(to),
    subject,
    html,
    text,
  });
}

// 💸 Withdrawal: request received
export async function sendWithdrawalRequestReceivedEmail({
  to,
  amount,
  walletAddress,
  ip,
  ua,
  atIso,
} = {}) {
  const resend = getResend();
  const from = safeFrom(process.env.EMAIL_FROM || "REGORIXA <noreply@regorixa.com>");

  const at = formatTime(atIso);
  const safeIpVal = safeIp(ip);
  const safeUaVal = safeUa(ua);

  const subject = "REGORIXA withdrawal request received";

  const safeAmount = safeTextField(amount, 80);
  const safeWallet = safeTextField(walletAddress, 180);

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6">
      <h2>Withdrawal request received</h2>
      <p>We received your withdrawal request. You will be notified within 24 hours.</p>
      <ul>
        <li><b>Amount:</b> ${escapeHtml(safeAmount)}</li>
        <li><b>Wallet (USDT TRC20):</b> ${escapeHtml(safeWallet)}</li>
        <li><b>Time:</b> ${escapeHtml(at)}</li>
        <li><b>IP:</b> ${escapeHtml(safeIpVal)}</li>
        <li><b>Device:</b> ${escapeHtml(safeUaVal)}</li>
      </ul>
      <p style="color:#666;font-size:12px">REGORIXA Security</p>
    </div>
  `;

  const text = `Withdrawal request received
Amount: ${safeAmount}
Wallet (USDT TRC20): ${safeWallet}
Time: ${at}
IP: ${safeIpVal}
Device: ${safeUaVal}

You will be notified within 24 hours.`;

  await resend.emails.send({
    from,
    to: safeEmail(to),
    subject,
    html,
    text,
  });
}

// 💸 Withdrawal: result (approved / rejected)
export async function sendWithdrawalResultEmail({
  to,
  status,
  amount,
  walletAddress,
  adminNote,
  atIso,
} = {}) {
  const resend = getResend();
  const from = safeFrom(process.env.EMAIL_FROM || "REGORIXA <noreply@regorixa.com>");

  const at = formatTime(atIso);
  const st = String(status || "").toLowerCase();
  const ok = st === "approved";

  const subject = ok ? "REGORIXA withdrawal approved" : "REGORIXA withdrawal rejected";

  const safeAmount = safeTextField(amount, 80);
  const safeWallet = safeTextField(walletAddress, 180);
  const safeNote = adminNote ? safeTextField(adminNote, 600) : "";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6">
      <h2>Withdrawal ${ok ? "approved" : "rejected"}</h2>
      <ul>
        <li><b>Amount:</b> ${escapeHtml(safeAmount)}</li>
        <li><b>Wallet (USDT TRC20):</b> ${escapeHtml(safeWallet)}</li>
        <li><b>Time:</b> ${escapeHtml(at)}</li>
      </ul>
      ${safeNote ? `<p><b>Note:</b> ${escapeHtml(safeNote)}</p>` : ""}
      <p style="color:#666;font-size:12px">REGORIXA</p>
    </div>
  `;

  const text = `Withdrawal ${ok ? "approved" : "rejected"}
Amount: ${safeAmount}
Wallet (USDT TRC20): ${safeWallet}
Time: ${at}
${safeNote ? `Note: ${safeNote}\n` : ""}`;

  await resend.emails.send({
    from,
    to: safeEmail(to),
    subject,
    html,
    text,
  });
}
// ✅ Plan: approved
export async function sendPlanApprovedEmail({ to, planName, dashboardUrl, req } = {}) {
  const resend = getResend();
  const from = safeFrom(process.env.EMAIL_FROM || "REGORIXA <noreply@regorixa.com>");

  const baseUrl = getPublicBaseUrl(req);
  const dash = dashboardUrl || joinUrl(baseUrl, "/dashboard");
  const myPlanUrl = joinUrl(baseUrl, "/dashboard"); // اگر صفحه جدا داری عوضش کن

  const safePlan = planName ? safeTextField(planName, 120) : "";

  const subject = "✅ Your plan purchase is approved | REGORIXA";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.8">
      <h2>Plan purchase approved ✅</h2>
      <p>Thank you for trusting <b>REGORIXA</b> 🙏</p>
      <p>Your plan purchase has been <b>approved</b> successfully.</p>
      ${safePlan ? `<p><b>Plan:</b> ${escapeHtml(safePlan)}</p>` : ""}

      <p>You can now log in to your dashboard and go to <b>My Plan</b> to start your investment.</p>

      <p style="margin-top:14px">
        <a href="${dash}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#0ea5a5;color:#fff;text-decoration:none">
          Open Dashboard
        </a>
      </p>

      <p style="color:#666;font-size:12px;margin-top:18px">
        If you have any questions, reply to this email.
      </p>
      <p style="color:#666;font-size:12px">REGORIXA</p>
    </div>
  `;

  const text =
    `Plan purchase approved ✅\n\n` +
    `Thank you for trusting REGORIXA 🙏\n` +
    (safePlan ? `Plan: ${safePlan}\n\n` : "\n") +
    `You can now open your dashboard and go to My Plan to start your investment.\n\n` +
    `Dashboard: ${dash}\n`;

  await resend.emails.send({
    from,
    to: safeEmail(to),
    subject,
    html,
    text,
  });
}

// ✅ Investment: approved
export async function sendInvestmentApprovedEmail({
  to,
  planName,
  amount,
  nextProfitAt,
  dashboardUrl,
  req,
} = {}) {
  const resend = getResend();
  const from = safeFrom(process.env.EMAIL_FROM || "REGORIXA <noreply@regorixa.com>");

  const baseUrl = getPublicBaseUrl(req);
  const dash = dashboardUrl || joinUrl(baseUrl, "/dashboard");

  const safePlan = planName ? safeTextField(planName, 120) : "";
  const safeAmount = amount != null ? safeTextField(String(amount), 80) : "";

  const nextProfitText = nextProfitAt ? formatTime(nextProfitAt) : "";

  const subject = "💰 Your investment is approved | REGORIXA";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.8">
      <h2>Investment approved ✅</h2>
      <p>Thank you for trusting <b>REGORIXA</b> 🙏</p>
      <p>Your investment has been <b>approved</b> successfully.</p>

      <ul>
        ${safePlan ? `<li><b>Plan:</b> ${escapeHtml(safePlan)}</li>` : ""}
        ${safeAmount ? `<li><b>Amount:</b> ${escapeHtml(safeAmount)} USDT</li>` : ""}
        ${nextProfitText ? `<li><b>Next profit date:</b> ${escapeHtml(nextProfitText)}</li>` : ""}
      </ul>

      <p>You can open your dashboard and view your profit schedule in <b>My Plan</b>.</p>

      <p style="margin-top:14px">
        <a href="${dash}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#0ea5a5;color:#fff;text-decoration:none">
          Open Dashboard
        </a>
      </p>

      <p style="color:#666;font-size:12px;margin-top:18px">REGORIXA</p>
    </div>
  `;

  const text =
    `Investment approved ✅\n\n` +
    `Thank you for trusting REGORIXA 🙏\n\n` +
    (safePlan ? `Plan: ${safePlan}\n` : "") +
    (safeAmount ? `Amount: ${safeAmount} USDT\n` : "") +
    (nextProfitText ? `Next profit date: ${nextProfitText}\n` : "") +
    `\nOpen your dashboard to view your profit schedule in My Plan:\n${dash}\n`;

  await resend.emails.send({
    from,
    to: safeEmail(to),
    subject,
    html,
    text,
  });
}
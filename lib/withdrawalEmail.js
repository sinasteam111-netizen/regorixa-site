// lib/withdrawalEmail.js

function cleanNoCrlf(v) {
  return String(v || "").replace(/[\r\n]+/g, " ").trim();
}

function clampLen(v, max = 5000) {
  const s = String(v || "");
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export function buildWithdrawalResultEmail({ status, amount, walletAddress, adminNote }) {
  const st = String(status || "").trim().toLowerCase();
  const amt = Number(amount || 0);
  const addr = cleanNoCrlf(walletAddress);
  const note = clampLen(cleanNoCrlf(adminNote), 5000);

  if (st === "approved") {
    return {
      subject: "Withdrawal request approved",
      message: [
        "Your withdrawal request has been approved.",
        "",
        `Amount: ${Number.isFinite(amt) ? amt : amount} USDT`,
        addr ? `Wallet: ${addr}` : "",
        "",
        "Your payment will be processed within the next 24 hours.",
        note ? "" : "",
        note ? `Admin note: ${note}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  return {
    subject: "Withdrawal request rejected",
    message: [
      "Your withdrawal request has been rejected.",
      "",
      `Amount: ${Number.isFinite(amt) ? amt : amount} USDT`,
      addr ? `Wallet: ${addr}` : "",
      "",
      note ? `Reason / note: ${note}` : "Reason / note: (not provided)",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function sanitizeAdminNote(adminNote) {
  return clampLen(cleanNoCrlf(adminNote), 5000);
}

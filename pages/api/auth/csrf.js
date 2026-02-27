// pages/api/auth/csrf.js
import { setNoStore } from "../../../lib/noStore";
import { issueCsrfToken } from "../../../lib/csrf";
import { applySecurityHeaders } from "../../../lib/securityHeaders";

export default async function handler(req, res) {
  try {
    setNoStore(res);
    applySecurityHeaders(res);
  } catch {}

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { token, setCookie } = issueCsrfToken();
  res.setHeader("Set-Cookie", setCookie);

  return res.status(200).json({ ok: true, csrfToken: token });
}
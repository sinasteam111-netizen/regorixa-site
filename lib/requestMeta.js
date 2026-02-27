export function getIp(req) {
  const h = req?.headers || {};

  function clean(v) {
    return String(v || "").trim().replace(/[\r\n\s]+/g, "");
  }

  function normalizeIp(ip) {
    if (!ip) return "";
    let v = clean(ip);

    // IPv6 localhost
    if (v === "::1") return "127.0.0.1";

    // IPv4-mapped IPv6
    if (v.startsWith("::ffff:")) v = v.slice(7);

    // basic sanity: allow hex, dot, colon
    if (!/^[0-9a-fA-F:.]+$/.test(v)) return "";

    return v;
  }

  // 1️⃣ Cloudflare
  const cf = h["cf-connecting-ip"];
  if (typeof cf === "string") {
    const ip = normalizeIp(cf);
    if (ip) return ip;
  }

  // 2️⃣ X-Forwarded-For (first IP)
  const xff = h["x-forwarded-for"];
  if (xff) {
    if (Array.isArray(xff)) {
      const ip = normalizeIp(xff[0]);
      if (ip) return ip;
    }
    if (typeof xff === "string") {
      const first = xff.split(",")[0];
      const ip = normalizeIp(first);
      if (ip) return ip;
    }
  }

  // 3️⃣ X-Real-IP
  const realIp = h["x-real-ip"];
  if (typeof realIp === "string") {
    const ip = normalizeIp(realIp);
    if (ip) return ip;
  }

  // 4️⃣ socket fallback
  const ra =
    req?.socket?.remoteAddress ||
    req?.connection?.remoteAddress ||
    "";

  const ip = normalizeIp(ra);
  return ip || "unknown";
}

export function getUa(req) {
  const ua = String(req?.headers?.["user-agent"] || "unknown");

  // remove CRLF + limit size
  return ua.replace(/[\r\n]+/g, " ").slice(0, 300);
}

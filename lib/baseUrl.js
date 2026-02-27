// lib/baseUrl.js

function stripTrailingSlashes(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function normalizeProto(v) {
  const p = String(v || "").split(",")[0].trim().toLowerCase();
  if (p === "https" || p === "http") return p;
  return "http";
}

function sanitizeHost(host) {
  // Take first value (some proxies append)
  const h = String(host || "").split(",")[0].trim();

  // Very small sanity check: allow hostname[:port], ipv4[:port], [ipv6][:port]
  // Block obvious injection characters/spaces
  if (!h || /[\s/\\]/.test(h)) return null;

  // Block CRLF injection
  if (/[\r\n]/.test(h)) return null;

  return h;
}

export function getPublicBaseUrl(req) {
  const envUrl = stripTrailingSlashes(
    process.env.NEXT_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || ""
  );

  if (envUrl) return envUrl;

  // Client-side
  if (typeof window !== "undefined") {
    return stripTrailingSlashes(window.location.origin);
  }

  // Server-side fallback (proxy-aware)
  const xfProto = req?.headers?.["x-forwarded-proto"];
  const proto = normalizeProto(xfProto);

  // Prefer x-forwarded-host when behind proxy, fallback to host
  const xfHost = req?.headers?.["x-forwarded-host"];
  const hostHeader = xfHost || req?.headers?.host || "localhost:3000";
  const host = sanitizeHost(hostHeader) || "localhost:3000";

  // Optional x-forwarded-port (some setups)
  const xfPort = String(req?.headers?.["x-forwarded-port"] || "").split(",")[0].trim();
  let finalHost = host;

  // If host doesn't already include a port and xfPort exists, append it (unless default)
  if (xfPort && !finalHost.includes(":")) {
    const isDefaultPort = (proto === "https" && xfPort === "443") || (proto === "http" && xfPort === "80");
    if (!isDefaultPort) finalHost = `${finalHost}:${xfPort}`;
  }

  return stripTrailingSlashes(`${proto}://${finalHost}`);
}

// lib/securityHeaders.js

export function applySecurityHeaders(res, options = {}) {
  const isProd = process.env.NODE_ENV === "production";

  const {
    contentSecurityPolicy =
      "default-src 'self'; " +
      "base-uri 'self'; " +
      "frame-ancestors 'none'; " +
      "object-src 'none'; " +
      "img-src 'self' data: blob: https:; " +
      "font-src 'self' data: https:; " +
      "style-src 'self' 'unsafe-inline' https:; " +
      // ✅ در prod eval رو قطع می‌کنیم ولی inline رو نگه می‌داریم تا استایل‌ها/Next نشکنه
      (isProd
        ? "script-src 'self' 'unsafe-inline' https:; "
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; ") +
      "connect-src 'self' https: wss:;",

    enableHsts = isProd,
  } = options;

  if (!res || typeof res.setHeader !== "function") return;

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

  if (contentSecurityPolicy) res.setHeader("Content-Security-Policy", contentSecurityPolicy);

  if (enableHsts) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
}
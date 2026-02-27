/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: "export",

  async headers() {
    const isProd = process.env.NODE_ENV === "production";

    const csp =
      "default-src 'self'; " +
      "base-uri 'self'; " +
      "frame-ancestors 'none'; " +
      "object-src 'none'; " +
      // ✅ برای QR data:image/... لازم
      "img-src 'self' data: blob: https:; " +
      // ✅ برای فونت‌ها (اگر لازم شد)
      "font-src 'self' data: https:; " +
      // ✅ چون شما inline style دارید (و React/Next هم بعضی جاها نیاز پیدا می‌کنه)
      "style-src 'self' 'unsafe-inline' https:; " +
      // ✅ برای dev ممکنه eval لازم بشه (خصوصاً با برخی ابزارها)
      (isProd
        ? "script-src 'self' 'unsafe-inline' https:; "
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; ") +
      // ✅ API calls / websocket اگر داشتی
      "connect-src 'self' https: wss:;";

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },

          // ✅ CSP updated (QR + inline style)
          { key: "Content-Security-Policy", value: csp },

          ...(isProd
            ? [{ key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
import { rateLimit } from "../../../lib/rateLimit";
import { getIp } from "../../../lib/ipUa";

function cachePublic(res) {
  // ✅ 30 ثانیه cache (برای public config عالیه)
  // stale-while-revalidate باعث میشه حتی بهتر هم بشه
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
}

export default function handler(req, res) {
  try {
    cachePublic(res);

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false });
    }

    // ✅ rate limit (public read) — dev شل، prod نرمال
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const plan = String(req.query?.plan || "").trim().toLowerCase();
      const isProd = process.env.NODE_ENV === "production";

      const rl = rateLimit(`public:wallet:${ip}:${p}:${plan}`, {
        windowMs: 60 * 1000,
        max: isProd ? 120 : 2000, // ✅ dev: 2000/min ، prod: 120/min
      });

      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {
      // fail-open برای حفظ رفتار
    }

    const plan = String(req.query?.plan || "").trim().toLowerCase();

    // ✅ INVESTMENT wallet (separate)
    if (plan === "invest" || plan === "investment") {
      return res.json({
        ok: true,
        wallet: process.env.USDT_TRC20_WALLET_INVEST || "",
      });
    }

    if (plan === "base") {
      return res.json({
        ok: true,
        wallet: process.env.USDT_TRC20_WALLET_BASE || "",
      });
    }

    if (plan === "advanced") {
      return res.json({
        ok: true,
        wallet: process.env.USDT_TRC20_WALLET_ADVANCED || "",
      });
    }

    // ✅ VIP (accept multiple env keys)
    if (plan === "vip") {
      const vipWallet =
        process.env.USDT_TRC20_WALLET_VIP ||
        process.env.VIP_WALLET_TRC20 ||
        process.env.VIP_WALLET ||
        "";

      return res.json({
        ok: true,
        wallet: vipWallet,
      });
    }

    return res.status(400).json({ ok: false });
  } catch (e) {
    console.error("wallet-by-plan error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
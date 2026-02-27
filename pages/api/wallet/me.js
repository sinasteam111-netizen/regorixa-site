import { getSession } from "../../../lib/auth";
import { findUserByEmail } from "../../../lib/userStore";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp } from "../../../lib/ipUa";
import { setNoStore } from "../../../lib/noStore";
import { getWalletRow } from "../../../lib/walletStore";

function norm(s) {
  return String(s || "").trim();
}

function getVipWalletFromEnv() {
  return norm(process.env.VIP_WALLET_TRC20 || process.env.VIP_WALLET || "");
}

export default async function handler(req, res) {
  try {
    setNoStore(res);

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ rate limit سبک (read)
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`wallets:me:${ip}:${p}`, { windowMs: 60 * 1000, max: 120 });
      if (!rl.ok) {
        return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {}

    // ✅ VIP wallet always available (public address)
    const vipWallet = getVipWalletFromEnv();

    // ✅ Try auth for user-specific wallet (optional)
    const session = getSession(req);
    if (!session?.email) {
      // Return VIP wallet even if not authenticated (no 401)
      return res.status(200).json({
        ok: true,
        auth: false,

        // keep old fields (non-breaking)
        wallet: "",
        updatedAt: null,

        // VIP fields
        vipWallet: vipWallet || "",
        trc20: vipWallet || "",
        address: vipWallet || "",
      });
    }

    const emailNorm = String(session.email || "").trim().toLowerCase();
    const user = await findUserByEmail(emailNorm);
    if (!user?.email) {
      return res.status(200).json({
        ok: true,
        auth: false,
        wallet: "",
        updatedAt: null,
        vipWallet: vipWallet || "",
        trc20: vipWallet || "",
        address: vipWallet || "",
      });
    }

    const row = await getWalletRow(String(user.email || "").trim().toLowerCase());
    const userWallet = norm(row?.wallet || "");

    return res.status(200).json({
      ok: true,
      auth: true,

      // old fields
      wallet: userWallet,
      updatedAt: row?.updatedAt || null,

      // VIP fields
      vipWallet: vipWallet || "",
      trc20: vipWallet || "",
      address: vipWallet || "",
      walletInfo: {
        user: userWallet || "",
        vip: vipWallet || "",
      },
    });
  } catch (e) {
    console.error("wallets/me error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

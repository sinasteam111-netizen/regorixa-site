import fs from "fs/promises";
import path from "path";
import { getSession } from "../../../lib/auth";
import { findUserByEmail } from "../../../lib/userStore";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp } from "../../../lib/ipUa";

const DATA_DIR = path.join(process.cwd(), ".data");
const filePath = path.join(DATA_DIR, "tickets.json");

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

async function readTicketsSafe() {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  try {
    noStore(res);

    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    // ✅ rate limit سبک (read)
    try {
      const ip = getIp(req);
      const p = String(req?.url || "").split("?")[0] || "";
      const rl = rateLimit(`tickets:list:${ip}:${p}`, { windowMs: 60 * 1000, max: 60 });
      if (!rl.ok) {
        return res.status(429).json({ error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {}

    // ✅ session-based + user واقعی
    const session = getSession(req);
    if (!session?.email) {
      // قبلاً 400 userId is required بود، ولی برای امنیت واقعی باید auth بخواد.
      // پیام‌ها رو خیلی تغییر نمی‌دیم: همون "userId is required" رو نگه می‌داریم تا UI نشکنه.
      return res.status(400).json({ error: "userId is required" });
    }

    const emailNorm = String(session.email || "").trim().toLowerCase();
    const user = await findUserByEmail(emailNorm);
    if (!user?.id) {
      return res.status(400).json({ error: "userId is required" });
    }

    const userId = String(user.id);

    const all = await readTicketsSafe();
    const mine = all.filter((t) => String(t?.user?.id) === userId);

    return res.status(200).json({ tickets: mine });
  } catch (e) {
    console.error("tickets list error:", e);
    return res.status(500).json({ error: "Failed to read tickets" });
  }
}

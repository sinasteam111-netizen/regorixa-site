import fs from "fs/promises";
import path from "path";
import { getSession } from "../../../lib/auth";
import { findUserByEmail } from "../../../lib/userStore";
import { rateLimit } from "../../../lib/rateLimit";
import { getIp } from "../../../lib/ipUa";

const filePath = path.join(process.cwd(), ".data", "tickets.json");

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
      const rl = rateLimit(`tickets:unread-count:${ip}:${p}`, { windowMs: 60 * 1000, max: 120 });
      if (!rl.ok) {
        return res.status(429).json({ error: "Too many requests", resetAt: rl.resetAt });
      }
    } catch {}

    // ✅ session-based + user واقعی
    const session = getSession(req);
    if (!session?.email) {
      // برای سازگاری UI: همان پیام قبلی
      return res.status(400).json({ error: "userId is required" });
    }

    const emailNorm = String(session.email || "").trim().toLowerCase();
    const user = await findUserByEmail(emailNorm);
    if (!user?.id) {
      return res.status(400).json({ error: "userId is required" });
    }

    const userId = String(user.id);

    const all = await readTicketsSafe();
    const count = all.filter(
      (t) => String(t?.user?.id) === userId && t.unreadByUser === true
    ).length;

    return res.status(200).json({ count });
  } catch (e) {
    console.error("tickets unread-count error:", e);
    return res.status(500).json({ error: "Failed to read tickets" });
  }
}

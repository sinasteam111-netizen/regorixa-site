// pages/api/admin/tickets/list.js
import fs from "fs/promises";
import path from "path";
import { requireAdmin } from "../../../../lib/requireAdmin";

const DATA_DIR = path.join(process.cwd(), ".data");
const filePath = path.join(DATA_DIR, "tickets.json");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readTicketsSafe() {
  await ensureDir();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ admin gate (session + real user + role)
    const gate = await requireAdmin(req, res, { allowRoles: ["admin", "super_admin"] });
    if (!gate) return;

    const tickets = await readTicketsSafe();
    const unreadByAdmin = tickets.filter((t) => t?.unreadByAdmin === true).length;

    return res.status(200).json({ ok: true, tickets, unreadByAdmin });
  } catch (e) {
    console.error("admin/tickets/list error:", e);
    return res.status(500).json({ ok: false, error: "Failed to read tickets" });
  }
}

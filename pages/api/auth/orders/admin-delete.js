// pages/api/auth/orders/admin-delete.js
import { requireAdmin } from "../../../../lib/requireAdmin";
import { rateLimit } from "../../../../lib/rateLimit";
import { deleteOrderById } from "../../../../lib/orderstore";
import { getIp } from "../../../../lib/ipUa";
import { makeAuditEvent, appendAuditEvent } from "../../../../lib/auditLog";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function safeJsonParse(maybeString) {
  if (maybeString && typeof maybeString === "string") {
    try {
      return JSON.parse(maybeString);
    } catch {
      return null;
    }
  }
  return maybeString;
}

function isBadKey(s) {
  return s === "__proto__" || s === "constructor" || s === "prototype";
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  let gate = null;

  try {
    noStore(res);

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // Admin gate
    gate = await requireAdmin(req, res, {
      allowRoles: ["admin", "super_admin"],
    });
    if (!gate) return;

    const adminEmail = String(gate.user?.email || "").toLowerCase();
    const adminId = gate.user?.id || gate.user?.userId || adminEmail || "admin";
    const ip = getIp(req) || "unknown";
    const ua = req.headers["user-agent"] || null;

    // Rate limit (per admin + ip)
    const rl = rateLimit(`admin:orders:delete:${adminEmail}:${ip}`, {
      windowMs: 60_000,
      max: 60,
    });
    if (!rl.ok) {
      return res.status(429).json({
        ok: false,
        error: "Too many requests",
        resetAt: rl.resetAt,
      });
    }

    // Body validation (object OR string)
    const body = safeJsonParse(req.body) || {};
    const id = String(body.id || "").trim();

    if (!id || isBadKey(id)) {
      return res.status(400).json({ ok: false, error: "Missing/invalid id" });
    }

    const ok = await deleteOrderById(id);
    if (!ok) {
      // audit best-effort
      try {
        await appendAuditEvent(
          makeAuditEvent({
            actor: { type: "admin", id: adminId, email: adminEmail || null, ip, ua },
            action: "admin.orders.delete",
            target: { type: "order", id },
            ok: false,
            meta: { reason: "not_found", ms: Date.now() - startedAt },
          })
        );
      } catch {}
      return res.status(404).json({ ok: false, error: "Order not found" });
    }

    // audit best-effort
    try {
      await appendAuditEvent(
        makeAuditEvent({
          actor: { type: "admin", id: adminId, email: adminEmail || null, ip, ua },
          action: "admin.orders.delete",
          target: { type: "order", id },
          ok: true,
          meta: { ms: Date.now() - startedAt },
        })
      );
    } catch {}

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("admin-delete error:", e);

    // audit best-effort
    try {
      const adminEmail = String(gate?.user?.email || "").toLowerCase();
      const adminId = gate?.user?.id || gate?.user?.userId || adminEmail || "admin";
      const ip = getIp(req) || "unknown";
      const ua = req.headers["user-agent"] || null;

      await appendAuditEvent(
        makeAuditEvent({
          actor: { type: "admin", id: adminId, email: adminEmail || null, ip, ua },
          action: "admin.orders.delete",
          target: { type: "order", id: null },
          ok: false,
          meta: { error: String(e?.message || "error"), ms: Date.now() - startedAt },
        })
      );
    } catch {}

    if (res.headersSent) return;
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
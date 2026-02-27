// pages/api/admin/withdrawals/resolve.js
import crypto from "crypto";
import { adminAction } from "../../../lib/adminAction";
import { rateLimit } from "../../../lib/rateLimit";
import { sendWithdrawalResultEmail } from "../../../lib/mailer";
import { makeAuditEvent, appendAuditEvent } from "../../../lib/auditLog";
import {
  readWithdrawals,
  writeWithdrawals,
  withWithdrawalsLock,
  appendWithdrawalsAudit,
} from "../../../lib/withdrawalsStore";
import { buildWithdrawalResultEmail, sanitizeAdminNote } from "../../../lib/withdrawalEmail";

function safeId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

function getReqIp(req) {
  return (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() || null;
}

export default adminAction(
  {
    action: "admin.withdrawals.resolve",
    target: (req) => ({ type: "withdrawal", id: String(req.body?.id || "") }),
    meta: (req) => ({
      id: String(req.body?.id || ""),
      status: req.body?.status ? String(req.body.status).toLowerCase() : null,
      noteLen: req.body?.adminNote ? String(req.body.adminNote).length : 0,
    }),
  },
  async (req, res, gate) => {
    const adminEmail = String(gate.user?.email || "").toLowerCase();

    // ✅ RL
    const rl = rateLimit(`withdraw:resolve:admin:${adminEmail}`, { windowMs: 60_000, max: 120 });
    if (!rl.ok) {
      return res.status(429).json({ ok: false, error: "Too many requests", resetAt: rl.resetAt });
    }

    const { id, status, adminNote } = req.body || {};
    const rid = String(id || "").trim();
    const st = String(status || "").trim().toLowerCase(); // approved | rejected

    if (!rid) return res.status(400).json({ ok: false, error: "id is required" });
    if (st !== "approved" && st !== "rejected") {
      return res.status(400).json({ ok: false, error: "Invalid status" });
    }

    const ip = getReqIp(req);
    const ua = req.headers["user-agent"] || null;

    const actor = {
      type: "admin",
      id: gate.user?.id || gate.user?.userId || adminEmail || "admin",
      email: adminEmail || null,
      ip,
      ua,
    };

    const result = await withWithdrawalsLock(async () => {
      const rows = await readWithdrawals();
      const idx = rows.findIndex((x) => String(x?.id) === rid);

      if (idx === -1) {
        // ✅ audit عمومی
        await appendAuditEvent(
          makeAuditEvent({
            actor,
            action: "withdrawal_resolve",
            target: { type: "withdrawal", id: rid },
            ok: false,
            reason: "Not found",
            meta: { rid, requestedStatus: st },
          })
        );

        // ✅ audit اختصاصی withdrawals (سازگار با سیستم فعلی)
        await appendWithdrawalsAudit(
          {
            type: "withdrawal_resolve_not_found",
            at: new Date().toISOString(),
            admin: adminEmail,
            requestId: rid,
            requestedStatus: st,
          },
          { awaitWrite: true }
        );

        return { status: 404, body: { ok: false, error: "Not found" } };
      }

      const current = rows[idx];

      // ✅ idempotency: اگر pending نیست، دوباره ننویس
      if (String(current.status || "") !== "pending") {
        await appendAuditEvent(
          makeAuditEvent({
            actor,
            action: "withdrawal_resolve",
            target: { type: "withdrawal", id: rid },
            ok: true,
            reason: "Idempotent: already resolved",
            meta: { rid, currentStatus: current.status, requestedStatus: st },
          })
        );

        await appendWithdrawalsAudit(
          {
            type: "withdrawal_resolve_idempotent",
            at: new Date().toISOString(),
            admin: adminEmail,
            requestId: rid,
            currentStatus: String(current.status || ""),
            requestedStatus: st,
          },
          { awaitWrite: false }
        );

        return { status: 200, body: { ok: true, withdrawal: current, idempotent: true } };
      }

      const updatedAt = new Date().toISOString();
      const noteSafe = sanitizeAdminNote(adminNote);

      const updated = {
        ...current,
        status: st,
        adminNote: noteSafe,
        updatedAt,
        resolvedBy: adminEmail,
        resolveId: safeId(),
      };

      rows[idx] = updated;
      await writeWithdrawals(rows);

      // ✅ audit عمومی (before/after)
      await appendAuditEvent(
        makeAuditEvent({
          actor,
          action: "withdrawal_resolved",
          target: { type: "withdrawal", id: rid },
          ok: true,
          before: {
            status: current.status || null,
            updatedAt: current.updatedAt || null,
            resolvedBy: current.resolvedBy || null,
            adminNoteLen: current.adminNote ? String(current.adminNote).length : 0,
          },
          after: {
            status: updated.status,
            updatedAt: updated.updatedAt,
            resolvedBy: updated.resolvedBy,
            resolveId: updated.resolveId,
            adminNoteLen: updated.adminNote ? String(updated.adminNote).length : 0,
          },
          meta: {
            rid,
            amount: updated.amount ?? null,
            walletAddress: updated.walletAddress || null,
            email: updated.email || null,
          },
        })
      );

      // ✅ audit اختصاصی withdrawals
      await appendWithdrawalsAudit(
        {
          type: "withdrawal_resolved",
          at: updatedAt,
          admin: adminEmail,
          requestId: rid,
          status: st,
          noteLen: noteSafe ? String(noteSafe).length : 0,
          resolveId: updated.resolveId,
        },
        { awaitWrite: true }
      );

      return { status: 200, body: { ok: true, withdrawal: updated }, row: updated };
    });

    // ✅ ایمیل خارج lock
    if (result?.status === 200 && result?.row) {
      try {
        const emailText = buildWithdrawalResultEmail({
          status: result.row.status,
          amount: result.row.amount,
          walletAddress: result.row.walletAddress,
          adminNote: result.row.adminNote || "",
        });

        await sendWithdrawalResultEmail({
          to: result.row.email,
          status: result.row.status,
          amount: result.row.amount,
          walletAddress: result.row.walletAddress,
          adminNote: result.row.adminNote || "",
          atIso: result.row.updatedAt,
          subject: emailText.subject,
          message: emailText.message,
        });
      } catch {
        // ignore
      }
    }

    return res.status(result.status).json(result.body);
  }
);

// lib/adminAction.js
import { requireAdmin } from "./requireAdmin";
import { setNoStore } from "./noStore";
import { makeAuditEvent, appendAuditEvent } from "./auditLog";

function getReqMeta(req) {
  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    null;
  const ua = req.headers["user-agent"] || null;
  return { ip, ua };
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

/**
 * یکسان‌سازی body:
 * - Next.js معمولاً object می‌دهد
 * - بعضی جاها ممکن است string باشد
 */
function parseBody(req) {
  const parsed = safeJsonParse(req.body);
  if (parsed && typeof parsed === "object") return parsed;
  return {};
}

/**
 * adminAction(options, handler)
 * - wrapper استاندارد برای endpointهای ادمین
 * - جلوگیری از cache
 * - ثبت audit روی موفق/ناموفق
 * - bodyParsed برای همه endpointها
 */
export function adminAction(options, handler) {
  return async function wrapped(req, res) {
    // bodyParsed را همیشه ست کن تا بقیه بتوانند استفاده کنند
    try {
      req.bodyParsed = parseBody(req);
    } catch {
      req.bodyParsed = {};
    }

    let gate = null;
    let actor = null;
    let action = options?.action || "admin.unknown";
    let target = options?.target;
    let before = null;

    try {
      // no-store
      try {
        if (typeof setNoStore === "function") setNoStore(res);
      } catch {}

      // فقط mutating methods
      const method = req.method || "GET";
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }

      gate = await requireAdmin(req, res, {
        allowRoles: options?.allowRoles || ["admin", "super_admin"],
      });
      if (!gate) return;

      const adminEmail = String(gate.user?.email || "").toLowerCase();
      const adminId = gate.user?.id || gate.user?.userId || adminEmail || "admin";
      const { ip, ua } = getReqMeta(req);

      actor = {
        type: "admin",
        id: String(adminId),
        email: adminEmail || null,
        ip,
        ua,
      };

      // target (اگر function بود)
      if (typeof options?.target === "function") {
        try {
          target = options.target(req, gate);
        } catch {
          target = { type: "unknown", id: null };
        }
      }

      // before
      if (typeof options?.getBefore === "function") {
        try {
          before = await options.getBefore(req, gate);
        } catch {
          before = null;
        }
      }

      // --- run handler ---
      let result;
      try {
        result = await handler(req, res, gate);

        // اگر handler خودش response فرستاده، result ممکنه undefined باشه
        // در هر صورت audit success رو ثبت می‌کنیم
        let after = null;
        if (typeof options?.getAfter === "function") {
          try {
            after = await options.getAfter(req, gate, result);
          } catch {
            after = null;
          }
        }

        try {
          const ev = makeAuditEvent({
            actor,
            action,
            target: target || { type: "unknown", id: null },
            ok: true,
            reason: null,
            before,
            after,
            meta: typeof options?.meta === "function" ? options.meta(req, gate, result) : null,
          });
          await appendAuditEvent(ev);
        } catch {}

        return result; // اگر handler خودش res رو داده، این undefined برمی‌گرده که مشکلی نداره
      } catch (e) {
        // audit failure
        try {
          const ev = makeAuditEvent({
            actor,
            action,
            target: target || { type: "unknown", id: null },
            ok: false,
            reason: e?.message || "Unknown error",
            before,
            after: null,
            meta: typeof options?.meta === "function" ? options.meta(req, gate) : null,
          });
          await appendAuditEvent(ev);
        } catch {}

        // اگر handler قبلاً response داده، دوباره نفرست
        if (res.headersSent) return;

        // احترام به statusCode/code اگر گذاشته باشند
        const statusCode =
          Number.isFinite(e?.statusCode) ? e.statusCode :
          Number.isFinite(e?.status) ? e.status :
          500;

        if (statusCode === 401) return res.status(401).json({ ok: false, error: "Unauthorized" });
        if (statusCode === 403) return res.status(403).json({ ok: false, error: "Forbidden" });
        if (statusCode === 404) return res.status(404).json({ ok: false, error: "Not found" });

        return res.status(statusCode).json({ ok: false, error: "Server error" });
      }
    } catch (e) {
      // آخرین لایه
      try {
        if (actor) {
          const ev = makeAuditEvent({
            actor,
            action,
            target: (typeof target === "function" ? null : target) || { type: "unknown", id: null },
            ok: false,
            reason: e?.message || "Unknown error",
            before: before || null,
            after: null,
            meta: null,
          });
          await appendAuditEvent(ev);
        }
      } catch {}

      if (res.headersSent) return;
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  };
}
// pages/api/internal/cron/run.js
import { noStore } from "../../../../lib/noStore";
import { requireCronSecret } from "../../../../lib/cronAuth";
import { runProfitJob } from "../../../../lib/jobs/runProfitJob";
import { rateLimit } from "../../../../lib/rateLimit";
import { applySecurityHeaders } from "../../../../lib/securityHeaders";
import { secureEqual } from "../../../../lib/secureCompare";

export default async function handler(req, res) {
  try {
    noStore(res);
    applySecurityHeaders(res);
  } catch {}

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // ✅ optional: harden content-type (prevents weird form submits)
  const ct = String(req.headers["content-type"] || "");
  if (ct && !ct.includes("application/json")) {
    return res.status(415).json({ ok: false, error: "Unsupported Media Type" });
  }

  // ✅ rate limit (fail-closed)
  // اگر cron از یک سرویس ثابت میاد (GitHub Actions / cron-job.org / VPS)،
  // این کمک می‌کنه endpoint با brute request ها کوبیده نشه.
  try {
    const rl = rateLimit("internal:cron:run", {
      windowMs: 60 * 1000,
      max: 10, // 10/min کل سیستم
    });
    if (!rl.ok) {
      return res.status(429).json({
        ok: false,
        error: "Too many requests",
        resetAt: rl.resetAt,
      });
    }
  } catch (e) {
    return res.status(429).json({ ok: false, error: "Too many requests" });
  }

  try {
    requireCronSecret(req);
  } catch (e) {
    return res
      .status(e.statusCode || 500)
      .json({ ok: false, error: e.message || "Forbidden" });
  }

  // ✅ Keep your current header check, but make it timing-safe
  const got = req.headers["x-cron-secret"];
  const expected = process.env.CRON_SECRET;
  if (!got || !expected || !secureEqual(got, expected)) {
    return res.status(401).end();
  }

  const dryRun = Boolean(req.body?.dryRun);

  // اینجا می‌تونی چند job دیگه هم اضافه کنی (cleanup logs, rotate, ...)
  const profit = await runProfitJob({ dryRun });

  return res.json({ ok: true, profit });
}

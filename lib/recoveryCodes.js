// lib/recoveryCodes.js
import crypto from "crypto";

// تعداد iteration برای stretching
const DEFAULT_ITERS = 100_000;

/**
 * تولید کدهای ریکاوری (مثلاً 10 تا)
 */
export function generateRecoveryCodes(count = 10) {
  const codes = [];
  const n = Number.isFinite(count) && count > 0 ? Math.min(count, 50) : 10;

  for (let i = 0; i < n; i++) {
    // 8 کاراکتر هگز => 32 بیت (ساده ولی مناسب برای ریکاوری)
    const raw = crypto.randomBytes(4).toString("hex").toUpperCase(); // A1B2C3D4
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`; // A1B2-C3D4
    codes.push(code);
  }
  return codes;
}

/**
 * نرمال‌سازی (خط تیره و فاصله مهم نباشه)
 */
export function normalizeRecoveryCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function getPepper() {
  // pepper سِروری (حتماً تو env بذار)
  // اگر ست نشه، فقط هش ساده انجام می‌شه (سازگار با نسخه قبلی)
  return process.env.RECOVERY_CODE_PEPPER || "";
}

/**
 * هش امن برای ذخیره
 * - backward compatible
 * - اگر pepper موجود باشه: stretching + pepper
 */
export function hashRecoveryCode(code) {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return "";

  const pepper = getPepper();

  // اگر pepper نداریم → دقیقاً مثل قبل
  if (!pepper) {
    return crypto.createHash("sha256").update(normalized).digest("hex");
  }

  // stretching ساده (سریع ولی مقاوم‌تر از hash تکی)
  let buf = Buffer.from(normalized + pepper, "utf8");
  const iters =
    Number.isFinite(Number(process.env.RECOVERY_CODE_ITERS)) &&
    Number(process.env.RECOVERY_CODE_ITERS) > 0
      ? Math.min(Number(process.env.RECOVERY_CODE_ITERS), 500_000)
      : DEFAULT_ITERS;

  for (let i = 0; i < iters; i++) {
    buf = crypto.createHash("sha256").update(buf).digest();
  }

  return buf.toString("hex");
}

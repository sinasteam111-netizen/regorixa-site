// lib/cronAuth.js
export function requireCronSecret(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // اگر secret ست نشده، بهتره در prod اجازه نده
    throw new Error("CRON_SECRET is not set");
  }
  const got = req.headers["x-cron-secret"];
  if (!got || String(got) !== String(expected)) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }
  return true;
}

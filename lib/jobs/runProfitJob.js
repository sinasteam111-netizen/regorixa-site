// lib/jobs/runProfitJob.js
import { audit } from "../auditLog";
import { readOrders, writeOrders } from "../ordersStore"; 
// ^ با اسم واقعی storeهای خودت جایگزین کن

// نکته: اگر timezone Europe/Sofia تو کدت جای دیگه انجام شده، همون رو reuse کن.
// اینجا ساده نگه داشتیم.

function isoNow() {
  return new Date().toISOString();
}

/**
 * منطق شما:
 * - فقط orderType=investment و status=Approved
 * - monthly profits generation با clamped month logic
 * - بعد از Paid، profit بعدی auto ساخته می‌شود
 * اینجا hook می‌زنیم به همون توابع/منطق موجودتون.
 */
export async function runProfitJob({ dryRun = false } = {}) {
  const startedAt = isoNow();

  const ordersDoc = await readOrders();

  // ✅ اینجا فرض گرفتم ساختار profits/orderها توی ordersStore هست
  // اگر ساختارت فرق داره، تو فقط همین بخش‌های دسترسی رو adjust می‌کنی.
  const orders = ordersDoc?.orders || [];
  const profits = ordersDoc?.profits || [];

  let created = 0;
  let advanced = 0;

  // --- جایگزین کن با engine واقعی خودت ---
  // pseudo: اگر investment approved هست و برای ماه بعد profit نداریم => بساز
  for (const o of orders) {
    if (o?.orderType !== "investment") continue;
    if (o?.status !== "Approved") continue;

    // این کلیدها رو با ساختار خودت هماهنگ کن
    const orderId = o.id || o.orderId;
    if (!orderId) continue;

    // نمونه شرط: اگر profit pending برای دوره بعد وجود ندارد
    const hasAny = profits.some((p) => p.orderId === orderId);
    if (!hasAny) {
      // اینجا با منطق واقعی "nextProfitDate" و "clamped month logic" بساز
      const p = {
        id: `pf_${orderId}_${Date.now()}`,
        orderId,
        userId: o.userId,
        status: "Pending",
        dueAt: isoNow(), // باید واقعی بشه
        createdAt: isoNow(),
      };
      profits.push(p);
      created++;
    }
  }

  // مثال advance: اگر profit Paid شد، next بساز (این هم باید واقعی بشه)
  // advanced++ ...

  if (!dryRun) {
    ordersDoc.profits = profits;
    await writeOrders(ordersDoc);
  }

  audit({
    actor: { type: "system", id: "cron" },
    action: "cron.profit.run",
    target: { type: "job", id: "profit" },
    ok: true,
    meta: { startedAt, finishedAt: isoNow(), dryRun, created, advanced },
  });

  return { ok: true, startedAt, finishedAt: isoNow(), dryRun, created, advanced };
}

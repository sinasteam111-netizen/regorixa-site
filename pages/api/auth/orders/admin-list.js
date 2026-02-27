import { readOrders } from "../../../../lib/orderstore";
import { requireAdmin } from "../../../../lib/requireAdmin";

function toInt(x, def) {
  const n = Number.parseInt(String(x ?? ""), 10);
  return Number.isFinite(n) ? n : def;
}

function s(x) {
  return String(x ?? "").trim();
}

function sl(x) {
  return s(x).toLowerCase();
}

function matchStatus(order, want) {
  const raw = sl(order?.status || order?.statusText || "");
  if (!want) return true;

  const w = sl(want);

  // حالت‌های عمومی
  if (w === "pending") return raw.includes("pending") || raw.includes("verification");
  if (w === "approved") return raw.includes("approved");
  if (w === "rejected") return raw.includes("rejected");

  // اگر مقدار خاص داده شد، با خود status/statusText چک می‌کنیم
  return raw === w;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const auth = await requireAdmin(req, res, {
      rateLimitKeyPrefix: "admin:orders:list",
      setNoStoreHeader: true,
    });
    if (!auth) return;

    const raw = await readOrders();
    let orders = Array.isArray(raw) ? raw : [];

    const q = sl(req.query?.q);
    const email = sl(req.query?.email);

    // ✅ پیش‌فرض جدید: اگر هیچ فیلتری ندادی → همه سفارش‌ها
    const status = s(req.query?.status); // optional
    const type = sl(req.query?.type);    // optional

    if (email) {
      orders = orders.filter((o) => sl(o?.userEmail) === email);
    }

    if (status) {
      orders = orders.filter((o) => matchStatus(o, status));
    }

    if (type) {
      orders = orders.filter((o) => sl(o?.orderType) === type);
    }

    if (q) {
      orders = orders.filter((o) => {
        const id = sl(o?.id);
        const ue = sl(o?.userEmail);
        const plan = sl(o?.plan);
        const tx = sl(o?.txid || o?.txidNorm);
        const st = sl(o?.status || o?.statusText);
        const ot = sl(o?.orderType);
        return (
          id.includes(q) ||
          ue.includes(q) ||
          plan.includes(q) ||
          tx.includes(q) ||
          st.includes(q) ||
          ot.includes(q)
        );
      });
    }

    orders.sort((a, b) => {
      const ta = Date.parse(a?.createdAt || a?.updatedAt || 0) || 0;
      const tb = Date.parse(b?.createdAt || b?.updatedAt || 0) || 0;
      return tb - ta;
    });

    const page = Math.max(1, toInt(req.query?.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query?.limit, 50)));
    const total = orders.length;
    const start = (page - 1) * limit;
    const items = orders.slice(start, start + limit);

    return res.status(200).json({
      ok: true,
      page,
      limit,
      total,
      orders: items,
    });
  } catch (e) {
    if (res.headersSent) return;
    console.error("admin-list error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
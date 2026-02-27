import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Nav from "../../components/Nav";
import { useLanguage } from "../../context/LanguageContext";
import translations from "../../translations"; // ✅ درست و یکدست

// ✅ order types
const TYPE_PLAN = "plan";
const TYPE_INVESTMENT = "investment";

function safeString(v) {
  return String(v ?? "").trim();
}

// ✅ formatter
function formatDate(dateLike, lang = "en") {
  if (!dateLike) return "-";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "-";

  const locale = lang === "fa" ? "fa-IR" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function formatDateTime(dateLike, lang = "en") {
  if (!dateLike) return "-";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "-";

  const locale = lang === "fa" ? "fa-IR" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function normalizeOrderType(o) {
  const t = String(o?.orderType || "").trim().toLowerCase();
  if (t === TYPE_INVESTMENT) return TYPE_INVESTMENT;
  return TYPE_PLAN;
}

// ✅ تاریخ + ماه
function daysInMonthUTC(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function addMonthsClampedUTC(dateLike, monthsToAdd) {
  const d = new Date(dateLike);

  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();

  const targetMonth = m + monthsToAdd;
  const targetYear = y + Math.floor(targetMonth / 12);
  const targetMonth0 = ((targetMonth % 12) + 12) % 12;

  const dim = daysInMonthUTC(targetYear, targetMonth0);
  const clampedDay = Math.min(day, dim);

  return new Date(Date.UTC(targetYear, targetMonth0, clampedDay, 12, 0, 0, 0));
}

function generateNextProfit(order) {
  const profits = Array.isArray(order.profits) ? order.profits : [];
  const nextMonth = profits.length + 1;

  let baseDate;
  if (profits.length === 0) {
    baseDate = order.investmentStartedAt || order.createdAt || new Date().toISOString();
  } else {
    baseDate = profits[profits.length - 1].dueAt;
  }

  const due = addMonthsClampedUTC(baseDate, 1);

  return {
    month: nextMonth,
    dueAt: due.toISOString(),
    paid: false,
    paidAt: null,
    amount: null,
  };
}

function ensureFirstProfitExists(order) {
  const o = { ...order };
  if (!Array.isArray(o.profits)) o.profits = [];
  if (o.profits.length === 0) {
    o.profits.push(generateNextProfit(o));
  }
  return o;
}

function toCsvCell(x) {
  const s = String(x ?? "");
  const escaped = s.replace(/"/g, '""');
  return `"${escaped}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function copyText(txt) {
  try {
    navigator.clipboard.writeText(String(txt || ""));
  } catch {}
}

// ✅ وضعیت‌ها را استاندارد می‌کنیم
function normStatusForUi(s) {
  const v = String(s || "").trim().toLowerCase();
  if (!v) return "Pending";
  if (v.includes("pending")) return "Pending";
  if (v.includes("verify") || v.includes("verification")) return "Pending";
  if (v.includes("approved") || v.includes("verified")) return "Approved";
  if (v.includes("rejected") || v.includes("declined")) return "Rejected";
  return String(s || "").trim();
}

export default function AdminOrdersPage() {
  const router = useRouter();
  const { lang, dir } = useLanguage();

  // ✅ t واقعی (قبلاً useMemo بدون استفاده بود)
  const t = useMemo(() => {
    const base = translations.en || {};
    const current = translations[lang] || base;
    return { ...base, ...current };
  }, [lang]);

  const [adminUser, setAdminUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all"); // all | pending | approved | rejected
  const [planFilter, setPlanFilter] = useState("all"); // all | base | advanced | vip | ...
  const [typeFilter, setTypeFilter] = useState("all"); // all | plan | investment

  const planOptions = useMemo(() => {
    const fromOrders = (orders || [])
      .map((o) => String(o?.plan || "").trim().toLowerCase())
      .filter(Boolean);

    const mustHave = ["base", "advanced", "vip"];
    const all = Array.from(new Set([...mustHave, ...fromOrders]));

    const priority = { base: 1, advanced: 2, vip: 3 };
    all.sort((a, b) => (priority[a] || 99) - (priority[b] || 99) || a.localeCompare(b));
    return all;
  }, [orders]);

  // ✅ sorting + paging
  const [sortBy, setSortBy] = useState("newest"); // newest | oldest | amountDesc | amountAsc
  const [page, setPage] = useState(1);
  const pageSize = 12;

  // ✅ sync initial filters from query
  useEffect(() => {
    if (!router.isReady) return;

    const qs = String(router.query.status || "");
    const qt = String(router.query.type || "");
    const qp = String(router.query.plan || "");
    const qq = String(router.query.q || "");

    if (qs) setFilter(qs);
    if (qt) setTypeFilter(qt);
    if (qp) setPlanFilter(qp);
    if (qq) setQ(qq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  // ✅ امن: ادمین بودن فقط از سرور (session) تعیین میشه
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" }); // ✅
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data?.ok || !data?.user?.email) {
          router.replace("/login");
          return;
        }

        const u = data.user;
        const role = String(u.role || "").toLowerCase();
        if (role !== "admin" && role !== "super_admin") {
          router.replace("/dashboard");
          return;
        }

        if (!mounted) return;
        setAdminUser(u);

        await refresh(); // initial load
      } catch {
        router.replace("/login");
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // ✅ بهتر: از سرور فیلتر بخواهیم (کم حجم‌تر + پیش‌فرض درست)
  function buildAdminListUrl() {
    const params = new URLSearchParams();

    // پیش‌فرض: pending investment (مثل چیزی که خودت می‌خواستی)
    const statusParam =
      filter === "all" ? "" : filter === "pending" ? "pending" : filter === "approved" ? "approved" : "rejected";

    const typeParam = typeFilter === "all" ? "" : typeFilter;
    const planParam = planFilter === "all" ? "" : planFilter;

    if (q.trim()) params.set("q", q.trim());
    if (statusParam) params.set("status", statusParam);
    if (typeParam) params.set("type", typeParam);
    if (planParam) params.set("plan", planParam);

    // اگر هیچ فیلتری ندادی، سرور خودش pending investment رو پیش‌فرض می‌گیره
    const qs = params.toString();
    return qs ? `/api/auth/orders/admin-list?${qs}` : "/api/auth/orders/admin-list";
  }

  async function refresh() {
    setLoadingOrders(true);
    try {
      const url = buildAdminListUrl();
      const res = await fetch(url, { credentials: "include" }); // ✅
      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.ok) setOrders(Array.isArray(data.orders) ? data.orders : []);
      else setOrders([]);
    } catch {
      setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  }

  async function apiUpdate(id, patch) {
    const res = await fetch("/api/auth/orders/admin-update", {
      method: "POST",
      credentials: "include", // ✅
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id, patch }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.error || "Update failed");
    return data.order;
  }

  async function apiDelete(id) {
    const res = await fetch("/api/auth/orders/admin-delete", {
      method: "POST",
      credentials: "include", // ✅
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.error || "Delete failed");
    return true;
  }

  async function updateStatus(order, status, forcedType) {
    if (!order?.id) return;

    const amount = Number(order?.amount || 0);
    const autoType = amount > 0 ? TYPE_INVESTMENT : TYPE_PLAN;

    const currentType = normalizeOrderType(order);
    const nextType =
      forcedType === TYPE_INVESTMENT ? TYPE_INVESTMENT : forcedType === TYPE_PLAN ? TYPE_PLAN : currentType;

    const finalType = forcedType ? nextType : autoType;

    let nextOrder = { ...order, orderType: finalType, status };

    if (status === "Approved" && nextOrder.orderType === TYPE_INVESTMENT) {
      nextOrder = ensureFirstProfitExists(nextOrder);
    }

    const patch = {
      orderType: nextOrder.orderType,
      status: nextOrder.status,
      // اگر pending شدیم، statusText هم ست کنیم
      statusText: status === "Pending" ? "Pending verification" : undefined,
      profits: Array.isArray(nextOrder.profits) ? nextOrder.profits : [],
    };

    // پاک کردن undefined ها (اختیاری)
    Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

    await apiUpdate(order.id, patch);
    await refresh();
  }

  async function setOrderType(order, newType) {
    if (!order?.id) return;

    let nextOrder = { ...order, orderType: newType };

    if (normStatusForUi(nextOrder.status) === "Approved" && newType === TYPE_INVESTMENT) {
      nextOrder = ensureFirstProfitExists(nextOrder);
      await apiUpdate(order.id, {
        orderType: newType,
        profits: nextOrder.profits,
      });
      await refresh();
      return;
    }

    await apiUpdate(order.id, { orderType: newType });
    await refresh();
  }

  function promptProfitAmount(defaultValue = "") {
    const raw = window.prompt("Profit amount (USDT):", String(defaultValue ?? ""));
    if (raw === null) return null;
    const v = String(raw).trim().replace(",", ".");
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return n;
  }

  async function payNextProfit(order) {
    if (!order?.id) return;

    if (normalizeOrderType(order) !== TYPE_INVESTMENT) {
      alert("This is a PLAN purchase. Profits are only for INVESTMENTS.");
      return;
    }

    if (normStatusForUi(order.status) !== "Approved") {
      alert("Order must be APPROVED first.");
      return;
    }

    const suggested = (() => {
      const ps = Array.isArray(order?.profits) ? order.profits : [];
      const last = ps.length ? ps[ps.length - 1] : null;
      return last?.paid ? "" : last?.amount ?? "";
    })();

    const amt = promptProfitAmount(suggested);
    if (amt === null) return;
    if (Number.isNaN(amt)) {
      alert("Invalid amount. Please enter a number (>= 0).");
      return;
    }

    let nextOrder = ensureFirstProfitExists(order);

    const profits = Array.isArray(nextOrder.profits) ? nextOrder.profits : [];
    const last = profits[profits.length - 1];
    const nowISO = new Date().toISOString();

    if (last && !last.paid) {
      const updatedProfits = profits.slice();
      updatedProfits[updatedProfits.length - 1] = {
        ...last,
        paid: true,
        paidAt: nowISO,
        amount: amt,
      };
      await apiUpdate(order.id, { profits: updatedProfits });
      await refresh();
      return;
    }

    const newProfit = generateNextProfit(nextOrder);
    newProfit.paid = true;
    newProfit.paidAt = nowISO;
    newProfit.amount = amt;

    await apiUpdate(order.id, { profits: profits.concat(newProfit) });
    await refresh();
  }

  async function undoLastProfit(order) {
    if (!order?.id) return;

    if (normalizeOrderType(order) !== TYPE_INVESTMENT) {
      alert("This is a PLAN purchase. Profits are only for INVESTMENTS.");
      return;
    }

    if (!Array.isArray(order.profits) || order.profits.length === 0) {
      alert("No profits to undo.");
      return;
    }

    const profits = order.profits.slice();
    const last = profits[profits.length - 1];

    if (last.paid) {
      profits[profits.length - 1] = { ...last, paid: false, paidAt: null, amount: null };
      await apiUpdate(order.id, { profits });
      await refresh();
      return;
    }

    alert("Last profit is already unpaid.");
  }

  async function deleteOrder(order) {
    if (!order?.id) return;

    const info = `Plan: ${safeString(order?.plan)}\nUser: ${safeString(order?.userEmail)}\nTxID: ${safeString(
      order?.txid
    )}\nType: ${safeString(order?.orderType || "plan")}\n\nThis cannot be undone.`;

    const ok = confirm(`DELETE this order?\n\n${info}`);
    if (!ok) return;

    try {
      await apiDelete(order.id);
      alert("Order deleted.");
      await refresh();
    } catch (e) {
      alert(e?.message || "Delete failed");
    }
  }

  // ✅ Client view (فیلترهای UI در کنار فیلتر سرور هم کار می‌کنن)
  const view = useMemo(() => {
    let list = orders.slice();

    // status filter client-side (robust)
    if (filter !== "all") {
      list = list.filter((o) => {
        const s = normStatusForUi(o.status || o.statusText);
        if (filter === "pending") return s === "Pending";
        if (filter === "approved") return s === "Approved";
        if (filter === "rejected") return s === "Rejected";
        return true;
      });
    }

    if (planFilter !== "all") {
      list = list.filter((o) => String(o.plan || "").toLowerCase() === planFilter);
    }

    if (typeFilter !== "all") {
      list = list.filter((o) => normalizeOrderType(o) === typeFilter);
    }

    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      list = list.filter(
        (o) =>
          String(o.userEmail || "").toLowerCase().includes(qq) ||
          String(o.txid || o.txidNorm || "").toLowerCase().includes(qq) ||
          String(o.plan || "").toLowerCase().includes(qq)
      );
    }

    if (sortBy === "newest") {
      list.sort((a, b) => {
        const ta = Date.parse(a.createdAt || a.updatedAt || 0) || 0;
        const tb = Date.parse(b.createdAt || b.updatedAt || 0) || 0;
        return tb - ta;
      });
    } else if (sortBy === "oldest") {
      list.sort((a, b) => {
        const ta = Date.parse(a.createdAt || a.updatedAt || 0) || 0;
        const tb = Date.parse(b.createdAt || b.updatedAt || 0) || 0;
        return ta - tb; // ✅ درست شد
      });
    } else if (sortBy === "amountDesc") {
      list.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    } else if (sortBy === "amountAsc") {
      list.sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
    }

    return list;
  }, [orders, q, filter, planFilter, typeFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(view.length / pageSize));
  const pageSafe = Math.min(Math.max(page, 1), totalPages);

  const paged = useMemo(() => {
    const start = (pageSafe - 1) * pageSize;
    return view.slice(start, start + pageSize);
  }, [view, pageSafe]);

  useEffect(() => {
    setPage(1);
  }, [q, filter, planFilter, typeFilter, sortBy]);

  function exportCsvCurrentView() {
    const rows = [
      ["id", "plan", "type", "status", "userEmail", "amount", "createdAt", "txid", "profitsCount"].map(toCsvCell),
    ];

    view.forEach((o) => {
      rows.push(
        [
          o.id || "",
          o.plan || "",
          normalizeOrderType(o),
          o.status || o.statusText || "Pending",
          o.userEmail || "",
          o.amount || "",
          o.createdAt || "",
          o.txid || "",
          Array.isArray(o.profits) ? o.profits.length : 0,
        ].map(toCsvCell)
      );
    });

    downloadCsv(`regorixa-orders-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  if (!adminUser) return null;

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">Admin</span>
          <span className="muted" style={{ fontSize: 12 }}>
            Orders • Approve/Reject • Investment profits • Delete orders
          </span>
        </div>

        <div className="sectionHeaderRow" style={{ alignItems: "center" }}>
          <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.2 }}>Orders</h1>

          <div className="btnRow" style={{ alignItems: "center" }}>
            <button className="btnGhost" onClick={refresh} disabled={loadingOrders}>
              {loadingOrders ? "Loading..." : "Refresh"}
            </button>

            <button className="btnPrimary" onClick={exportCsvCurrentView} disabled={loadingOrders || view.length === 0}>
              Export CSV
            </button>
          </div>
        </div>

        <div className="adminControls" style={{ marginTop: 16 }}>
          <input
            className="input"
            placeholder="Search by email / txid / plan..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>

          <select className="input" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
            <option value="all">All plans</option>
            {planOptions.map((p) => (
              <option key={p} value={p}>
                {p.toUpperCase()}
              </option>
            ))}
          </select>

          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            <option value="plan">Plan purchase</option>
            <option value="investment">Investment</option>
          </select>

          <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="newest">Sort: Newest</option>
            <option value="oldest">Sort: Oldest</option>
            <option value="amountDesc">Sort: Amount ↓</option>
            <option value="amountAsc">Sort: Amount ↑</option>
          </select>
        </div>

        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Source: Server orders (.data/orders.json) • Showing <b>{view.length}</b> matched
        </div>
      </div>

      <div className="sectionBox" style={{ marginTop: 18 }}>
        <div className="sectionHeaderRow">
          <h3 style={{ marginTop: 0 }}>Orders list</h3>

          <div className="btnRow" style={{ alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 12 }}>
              Page <b>{pageSafe}</b> / {totalPages}
            </span>
            <button className="btnGhost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe <= 1}>
              Prev
            </button>
            <button
              className="btnGhost"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={pageSafe >= totalPages}
            >
              Next
            </button>
          </div>
        </div>

        {loadingOrders ? (
          <div className="muted">Loading...</div>
        ) : view.length === 0 ? (
          <div className="muted">No orders found.</div>
        ) : (
          <>
            <div className="adminTableWrap">
              <table className="adminTable">
                <thead>
                  <tr>
                    <th className="colPlan">Plan</th>
                    <th className="colUser">User</th>
                    <th className="colAmount">Amount</th>
                    <th className="colCreated">Created</th>
                    <th className="colTx">TxID</th>
                    <th className="colStatus">Status</th>
                    <th className="colNext">Next profit</th>
                    <th className="colCount">Count</th>
                    <th className="colActions">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {paged.map((o, i) => {
                    const statusText = normStatusForUi(o.status || o.statusText);
                    const isApproved = statusText === "Approved";

                    const orderType = normalizeOrderType(o);
                    const isInvestment = orderType === TYPE_INVESTMENT;

                    const profits = Array.isArray(o.profits) ? o.profits : [];
                    const lastProfit = profits.length ? profits[profits.length - 1] : null;

                    const canMutate = !!o.id;

                    let nextProfitText = "-";
                    if (isApproved && isInvestment) {
                      const temp = ensureFirstProfitExists(o);
                      const ps = temp.profits || [];
                      const last = ps[ps.length - 1];

                      if (last && !last.paid) nextProfitText = formatDate(last.dueAt, lang);
                      else if (last && last.paid) {
                        const d = addMonthsClampedUTC(last.dueAt, 1);
                        nextProfitText = formatDate(d, lang);
                      }
                    }

                    return (
                      <tr key={o.id ? `id-${o.id}` : `${o.txid}-${i}`}>
                        <td className="cellStrong">{String(o.plan || "").toUpperCase()}</td>

                        <td className="cellUser">
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span>{o.userEmail || "-"}</span>
                            <button className="btnMini" onClick={() => copyText(o.userEmail)} title="Copy email">
                              Copy
                            </button>
                          </div>
                        </td>

                        <td>{o.amount} USDT</td>
                        <td>{o.createdAt ? formatDateTime(o.createdAt, lang) : "-"}</td>

                        <td className="cellTx">
                          <div className="txRow">
                            <code className="txid">{o.txid}</code>
                            <button className="btnMini" onClick={() => copyText(o.txid)} title="Copy TxID">
                              Copy
                            </button>
                          </div>
                        </td>

                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span
                              className={
                                statusText === "Approved"
                                  ? "statusOk"
                                  : statusText === "Rejected"
                                  ? "statusBad"
                                  : "statusPending"
                              }
                            >
                              {statusText}
                            </span>

                            <span className={isInvestment ? "statusOk" : "statusPending"} style={{ fontSize: 12 }}>
                              {isInvestment ? "Investment" : "Plan"}
                            </span>

                            <select
                              className="input"
                              style={{ height: 34, padding: "0 10px", fontSize: 12 }}
                              value={orderType}
                              onChange={(e) => setOrderType(o, e.target.value)}
                              disabled={!canMutate}
                            >
                              <option value="plan">Plan</option>
                              <option value="investment">Investment</option>
                            </select>

                            {!canMutate ? (
                              <span className="muted" style={{ fontSize: 12 }}>
                                (old order: missing id)
                              </span>
                            ) : null}
                          </div>
                        </td>

                        <td>{nextProfitText}</td>
                        <td>{isInvestment ? profits.length : "-"}</td>

                        <td>
                          <div className="actionBox">
                            <div className="actionGroup">
                              <div className="actionTitle">Quick</div>
                              <div className="actionBtns">
                                <button
                                  className="btnPrimary"
                                  disabled={!canMutate}
                                  onClick={() => updateStatus(o, "Approved", TYPE_PLAN)}
                                >
                                  Approve (Plan)
                                </button>

                                <button
                                  className="btnPrimary"
                                  disabled={!canMutate}
                                  onClick={() => updateStatus(o, "Approved", TYPE_INVESTMENT)}
                                >
                                  Approve (Inv.)
                                </button>

                                <button
                                  className="btnGhost"
                                  disabled={!canMutate}
                                  onClick={() => updateStatus(o, "Rejected")}
                                >
                                  Reject
                                </button>
                              </div>
                            </div>

                            <div className="actionGroup">
                              <div className="actionTitle">Profits</div>
                              <div className="actionBtns">
                                <button
                                  className="btnPrimary"
                                  disabled={!canMutate || !isApproved || !isInvestment}
                                  onClick={() => payNextProfit(o)}
                                >
                                  Pay next
                                </button>
                                <button
                                  className="btnGhost"
                                  disabled={!canMutate || !isApproved || !isInvestment || !lastProfit}
                                  onClick={() => undoLastProfit(o)}
                                >
                                  Undo last
                                </button>
                              </div>

                              {isInvestment && lastProfit ? (
                                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                                  Last: Month {lastProfit.month} • {lastProfit.paid ? "Paid" : "Unpaid"}{" "}
                                  {lastProfit.paid ? (
                                    <>
                                      • Amount: <b>{Number(lastProfit?.amount || 0)} USDT</b>{" "}
                                    </>
                                  ) : null}
                                  {lastProfit.paidAt ? `(${formatDateTime(lastProfit.paidAt, lang)})` : ""}
                                </div>
                              ) : null}
                            </div>

                            <div className="actionGroup">
                              <div className="actionTitle">Danger</div>
                              <div className="actionBtns">
                                <button
                                  className="btnGhost"
                                  disabled={!canMutate}
                                  onClick={() => deleteOrder(o)}
                                  style={{ borderColor: "rgba(255,80,80,0.45)" }}
                                >
                                  Delete
                                </button>

                                {/* ✅ هماهنگ با سیستم جدید */}
                                <button
                                  className="btnGhost"
                                  disabled={!canMutate}
                                  onClick={() => updateStatus(o, "Pending")}
                                >
                                  Pending
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cards (موبایل) — نسخه‌ی قبلی رو نگه داشتی، اینجا هم فقط Pending رو sync می‌کنیم */}
            <div className="adminCards">
              {paged.map((o, i) => {
                const statusText = normStatusForUi(o.status || o.statusText);
                const isApproved = statusText === "Approved";

                const orderType = normalizeOrderType(o);
                const isInvestment = orderType === TYPE_INVESTMENT;

                const profits = Array.isArray(o.profits) ? o.profits : [];
                const lastProfit = profits.length ? profits[profits.length - 1] : null;

                const canMutate = !!o.id;

                let nextProfitText = "-";
                if (isApproved && isInvestment) {
                  const temp = ensureFirstProfitExists(o);
                  const ps = temp.profits || [];
                  const last = ps[ps.length - 1];

                  if (last && !last.paid) nextProfitText = formatDate(last.dueAt, lang);
                  else if (last && last.paid) {
                    const d = addMonthsClampedUTC(last.dueAt, 1);
                    nextProfitText = formatDate(d, lang);
                  }
                }

                return (
                  <div className="adminCard" key={o.id ? `card-${o.id}` : `${o.txid}-card-${i}`}>
                    <div className="adminCardTop">
                      <div className="cellStrong">{String(o.plan || "").toUpperCase()}</div>
                      <span
                        className={
                          statusText === "Approved"
                            ? "statusOk"
                            : statusText === "Rejected"
                            ? "statusBad"
                            : "statusPending"
                        }
                      >
                        {statusText}
                      </span>
                    </div>

                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      Type: <b>{isInvestment ? "Investment" : "Plan"}</b> {!canMutate ? " (old order)" : ""}
                    </div>

                    <select
                      className="input"
                      style={{ marginTop: 10 }}
                      value={orderType}
                      onChange={(e) => setOrderType(o, e.target.value)}
                      disabled={!canMutate}
                    >
                      <option value="plan">Plan</option>
                      <option value="investment">Investment</option>
                    </select>

                    <div className="adminKV" style={{ marginTop: 10 }}>
                      <div className="k">User</div>
                      <div className="v">
                        {o.userEmail || "-"}{" "}
                        <button className="btnMini" onClick={() => copyText(o.userEmail)} style={{ marginLeft: 8 }}>
                          Copy
                        </button>
                      </div>

                      <div className="k">Amount</div>
                      <div className="v">{o.amount} USDT</div>

                      <div className="k">Created</div>
                      <div className="v">{o.createdAt ? formatDateTime(o.createdAt, lang) : "-"}</div>

                      <div className="k">Next profit</div>
                      <div className="v">{nextProfitText}</div>

                      <div className="k">Profit count</div>
                      <div className="v">{isInvestment ? profits.length : "-"}</div>

                      <div className="k">TxID</div>
                      <div className="v">
                        <code className="txid">{o.txid}</code>{" "}
                        <button className="btnMini" onClick={() => copyText(o.txid)} style={{ marginLeft: 8 }}>
                          Copy
                        </button>
                      </div>
                    </div>

                    {isInvestment && lastProfit ? (
                      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                        Last: Month {lastProfit.month} • {lastProfit.paid ? "Paid" : "Unpaid"}{" "}
                        {lastProfit.paid ? (
                          <>
                            • Amount: <b>{Number(lastProfit?.amount || 0)} USDT</b>{" "}
                          </>
                        ) : null}
                        {lastProfit.paidAt ? `(${formatDateTime(lastProfit.paidAt, lang)})` : ""}
                      </div>
                    ) : null}

                    <div className="cardActions" style={{ marginTop: 12 }}>
                      <div className="actionGroup">
                        <div className="actionTitle">Quick</div>
                        <div className="actionBtns" style={{ flexWrap: "wrap" }}>
                          <button className="btnPrimary" disabled={!canMutate} onClick={() => updateStatus(o, "Approved", TYPE_PLAN)}>
                            Approve (Plan)
                          </button>
                          <button className="btnPrimary" disabled={!canMutate} onClick={() => updateStatus(o, "Approved", TYPE_INVESTMENT)}>
                            Approve (Inv.)
                          </button>
                          <button className="btnGhost" disabled={!canMutate} onClick={() => updateStatus(o, "Rejected")}>
                            Reject
                          </button>
                          <button className="btnGhost" disabled={!canMutate} onClick={() => updateStatus(o, "Pending")}>
                            Pending
                          </button>
                        </div>
                      </div>

                      <div className="actionGroup">
                        <div className="actionTitle">Profits</div>
                        <div className="actionBtns">
                          <button className="btnPrimary" disabled={!canMutate || !isApproved || !isInvestment} onClick={() => payNextProfit(o)}>
                            Pay next
                          </button>
                          <button className="btnGhost" disabled={!canMutate || !isApproved || !isInvestment || !lastProfit} onClick={() => undoLastProfit(o)}>
                            Undo last
                          </button>
                        </div>
                      </div>

                      <div className="actionGroup">
                        <div className="actionTitle">Danger</div>
                        <div className="actionBtns">
                          <button className="btnGhost" disabled={!canMutate} onClick={() => deleteOrder(o)} style={{ borderColor: "rgba(255,80,80,0.45)" }}>
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <button className="btnGhost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe <= 1}>
                  Prev
                </button>
                <span className="muted" style={{ fontSize: 12 }}>
                  Page <b>{pageSafe}</b> / {totalPages}
                </span>
                <button className="btnGhost" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageSafe >= totalPages}>
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ height: 26 }} />
    </div>
  );
}
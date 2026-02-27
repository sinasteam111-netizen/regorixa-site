import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Nav from "../../components/Nav";
import { useLanguage } from "../../context/LanguageContext";
import { translations } from "../../translations";

const TYPE_INVESTMENT = "investment";

function normalizeOrderType(o) {
  const t = String(o?.orderType || "").trim().toLowerCase();
  if (t === TYPE_INVESTMENT) return TYPE_INVESTMENT;
  return "plan";
}

export default function AdminIndexPage() {
  const router = useRouter();
  const { lang, dir } = useLanguage();

  // ✅ ترجمه‌ها (اگر بعداً خواستی متن‌ها رو چندزبانه کنی)
  const t = useMemo(() => {
    const base = translations.en || {};
    const current = translations[lang] || base;
    return { ...base, ...current };
  }, [lang]);

  const [adminUser, setAdminUser] = useState(null);

  // orders summary
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // admin badges
  const [ticketUnread, setTicketUnread] = useState(0);
  const [loadingTicketsCount, setLoadingTicketsCount] = useState(false);

  const [withdrawalsPending, setWithdrawalsPending] = useState(0);
  const [loadingWithdrawalsCount, setLoadingWithdrawalsCount] = useState(false);

  const abortRef = useRef(null);
  const ticketIvRef = useRef(null);

  const fetchJson = async (url, opts = {}) => {
    const r = await fetch(url, {
      ...opts,
      credentials: "include",
      cache: "no-store",
      signal: abortRef.current?.signal,
      headers: {
        ...(opts.headers || {}),
        "Content-Type": opts.body ? "application/json" : (opts.headers?.["Content-Type"] || undefined),
      },
    });
    const d = await r.json().catch(() => ({}));
    return { r, d };
  };

  async function loadOrders() {
    setLoadingOrders(true);
    try {
      const { r: res, d: data } = await fetchJson("/api/auth/orders/admin-list");
      if (res.ok && data?.ok) setOrders(Array.isArray(data.orders) ? data.orders : []);
      else setOrders([]);
    } catch {
      setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  }

  async function loadTicketUnread() {
    setLoadingTicketsCount(true);
    try {
      const { r: res, d: data } = await fetchJson("/api/admin/tickets/list");
      // اگر auth پرید
      if (res.status === 401 || res.status === 403) {
        router.replace("/login");
        return;
      }
      setTicketUnread(Number(data?.unreadByAdmin || 0));
    } catch {
      setTicketUnread(0);
    } finally {
      setLoadingTicketsCount(false);
    }
  }

  async function loadWithdrawalsCount() {
    setLoadingWithdrawalsCount(true);
    try {
      const { r: res, d: data } = await fetchJson("/api/withdrawals/list");
      if (res.status === 401 || res.status === 403) {
        router.replace("/login");
        return;
      }
      if (res.ok && data?.ok) {
        const list = Array.isArray(data.withdrawals) ? data.withdrawals : [];
        setWithdrawalsPending(list.filter((x) => String(x?.status || "") === "pending").length);
      } else {
        setWithdrawalsPending(0);
      }
    } catch {
      setWithdrawalsPending(0);
    } finally {
      setLoadingWithdrawalsCount(false);
    }
  }

  const summary = useMemo(() => {
    const total = orders.length;
    const pending = orders.filter(
      (o) =>
        String(o.status || "Pending verification").toLowerCase().includes("pending") ||
        String(o.status || "Pending verification").toLowerCase().includes("verification")
    ).length;
    const approved = orders.filter((o) => String(o.status || "").toLowerCase().includes("approved")).length;
    const rejected = orders.filter((o) => String(o.status || "").toLowerCase().includes("rejected")).length;
    const investments = orders.filter((o) => normalizeOrderType(o) === TYPE_INVESTMENT).length;
    return { total, pending, approved, rejected, investments };
  }, [orders]);

  useEffect(() => {
    let mounted = true;

    // cancel previous
    try {
      abortRef.current?.abort?.();
    } catch {}
    abortRef.current = new AbortController();

    (async () => {
      try {
        const { r: res, d: data } = await fetchJson("/api/auth/me");
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

        await loadOrders();
        await loadTicketUnread();
        await loadWithdrawalsCount();

        // ✅ poll unread tickets every 30s (clean)
        if (ticketIvRef.current) clearInterval(ticketIvRef.current);
        ticketIvRef.current = setInterval(loadTicketUnread, 30000);
      } catch (e) {
        if (e?.name === "AbortError") return;
        router.replace("/login");
      }
    })();

    return () => {
      mounted = false;
      try {
        abortRef.current?.abort?.();
      } catch {}

      try {
        if (ticketIvRef.current) clearInterval(ticketIvRef.current);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, lang]);

  async function refreshAll() {
    await loadOrders();
    await loadTicketUnread();
    await loadWithdrawalsCount();
  }

  if (!adminUser) return null;

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">Admin</span>
          <span className="muted" style={{ fontSize: 12 }}>
            Clean dashboard • Orders • Payouts • Withdrawals • Tickets
          </span>
        </div>

        <div className="sectionHeaderRow" style={{ alignItems: "center" }}>
          <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.2 }}>Admin Panel</h1>

          <div className="btnRow" style={{ alignItems: "center" }}>
            <button className="btnGhost" onClick={refreshAll} disabled={loadingOrders}>
              {loadingOrders ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
        <div className="statusGrid" style={{ marginTop: 14 }}>
          <div
            className="statusCard"
            role="button"
            style={{ cursor: "pointer" }}
            onClick={() => router.push("/admin/orders?status=all")}
            title="Open all orders"
          >
            <div className="statusCardTop">
              <div className="cellStrong">Total orders</div>
              <span className="badge">{summary.total}</span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              All orders in system
            </div>
          </div>

          <div
            className="statusCard"
            role="button"
            style={{ cursor: "pointer" }}
            onClick={() => router.push("/admin/orders?status=pending")}
            title="Open pending orders"
          >
            <div className="statusCardTop">
              <div className="cellStrong">Pending</div>
              <span className="badge">{summary.pending}</span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Needs verification
            </div>
          </div>

          <div
            className="statusCard"
            role="button"
            style={{ cursor: "pointer" }}
            onClick={() => router.push("/admin/orders?status=approved")}
            title="Open approved orders"
          >
            <div className="statusCardTop">
              <div className="cellStrong">Approved</div>
              <span className="badge">{summary.approved}</span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Active / confirmed
            </div>
          </div>

          <div
            className="statusCard"
            role="button"
            style={{ cursor: "pointer" }}
            onClick={() => router.push("/admin/orders?type=investment")}
            title="Open investment orders"
          >
            <div className="statusCardTop">
              <div className="cellStrong">Investments</div>
              <span className="badge">{summary.investments}</span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Orders with profit schedule
            </div>
          </div>

          <div
            className="statusCard"
            role="button"
            onClick={() => router.push("/admin/payouts")}
            style={{ cursor: "pointer" }}
            title="Open payouts page"
          >
            <div className="statusCardTop">
              <div className="cellStrong">Today payouts</div>
              <span className="badge">Open</span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Mark paid • Base/Advanced/VIP
            </div>
          </div>

          <div
            className="statusCard"
            role="button"
            onClick={() => router.push("/admin/withdrawals")}
            style={{ cursor: "pointer" }}
            title="Open withdrawal requests"
          >
            <div className="statusCardTop">
              <div className="cellStrong">Withdrawal requests</div>
              <span className="badge">{loadingWithdrawalsCount ? "…" : withdrawalsPending}</span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Pending requests
            </div>
          </div>

          <div
            className="statusCard"
            role="button"
            onClick={() => router.push("/admin/tickets")}
            style={{ cursor: "pointer" }}
            title="Open tickets"
          >
            <div className="statusCardTop">
              <div className="cellStrong">Support tickets</div>

              {ticketUnread > 0 ? (
                <span
                  style={{
                    minWidth: 28,
                    height: 28,
                    padding: "0 9px",
                    borderRadius: 999,
                    fontSize: 13,
                    lineHeight: "28px",
                    textAlign: "center",
                    fontWeight: 700,
                    background: "#e53935",
                    color: "#fff",
                  }}
                >
                  {ticketUnread}
                </span>
              ) : (
                <span className="badge">{loadingTicketsCount ? "…" : 0}</span>
              )}
            </div>

            <div className="muted" style={{ fontSize: 12 }}>
              User messages & replies
            </div>
          </div>
        </div>

        <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          Tip: Orders و Payouts الان صفحه‌های جدا هستند (تمیز مثل Withdrawals).
        </div>

        {/* kept: t is currently unused but ready for future */}
        <div style={{ display: "none" }}>{t && ""}</div>
      </div>

      <div style={{ height: 26 }} />
    </div>
  );
}

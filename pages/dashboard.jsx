import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Nav from "../components/Nav";
import { useLanguage } from "../context/LanguageContext";
import Head from "next/head";

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// ✅ formatter (Dashboard/Admin هرجا تاریخ نشون میدی)
function formatDate(dateLike, lang = "en") {
  if (!dateLike) return "-";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "-";

  const locale =
    lang === "fa" ? "fa-IR" :
    lang === "en" ? "en-GB" : // ✅ en-GB = روز/ماه/سال
    "en-GB";

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// ✅ برای جاهایی که قبلاً toLocaleString() بود (تاریخ + زمان)
function formatDateTime(dateLike, lang = "en") {
  if (!dateLike) return "-";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "-";

  const locale =
    lang === "fa" ? "fa-IR" :
    lang === "en" ? "en-GB" :
    "en-GB";

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

// next profit از profits[] (infinite)
function getNextProfitDateFromOrder(order) {
  if (!order) return null;
  const profits = Array.isArray(order.profits) ? order.profits : [];

  if (profits.length === 0) {
    const d = new Date(order.createdAt);
    d.setMonth(d.getMonth() + 1);
    return d;
  }

  const last = profits[profits.length - 1];
  if (!last.paid) return new Date(last.dueAt);

  const d = new Date(last.dueAt);
  d.setMonth(d.getMonth() + 1);
  return d;
}

function getNextPlusOne(d) {
  if (!d) return null;
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1);
  return x;
}

function isLikelyTrc20Address(addr) {
  const s = String(addr || "").trim();
  // TRON base58 typically starts with T and length ~34
  if (!s) return false;
  if (!/^T[1-9A-HJ-NP-Za-km-z]{25,45}$/.test(s)) return false;
  return true;
}

// ✅ اگر سفارش‌های قدیمی ETA نداشتن، پیش‌فرض بساز
const DEFAULT_APPROVAL_WINDOW_HOURS = { min: 1, max: 6 };

function ensureEta(order) {
  if (!order) return null;

  const hasEta = order.etaText || order.etaMinAt || order.etaMaxAt;

  if (hasEta) {
    return {
      etaText:
        order.etaText ||
        `${DEFAULT_APPROVAL_WINDOW_HOURS.min}–${DEFAULT_APPROVAL_WINDOW_HOURS.max} hours`,
      etaMinAt: order.etaMinAt || null,
      etaMaxAt: order.etaMaxAt || null,
    };
  }

  // اگر اصلاً ETA ذخیره نشده بود، با createdAt بساز
  const baseTime = order.createdAt ? new Date(order.createdAt).getTime() : Date.now();
  const etaText = `${DEFAULT_APPROVAL_WINDOW_HOURS.min}–${DEFAULT_APPROVAL_WINDOW_HOURS.max} hours`;
  const etaMinAt = new Date(baseTime + DEFAULT_APPROVAL_WINDOW_HOURS.min * 60 * 60 * 1000).toISOString();
  const etaMaxAt = new Date(baseTime + DEFAULT_APPROVAL_WINDOW_HOURS.max * 60 * 60 * 1000).toISOString();

  return { etaText, etaMinAt, etaMaxAt };
}

function formatRemaining(ms) {
  if (ms <= 0) return "0m";
  const totalMinutes = Math.ceil(ms / (60 * 1000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function isPendingStatus(status) {
  const s = String(status || "").toLowerCase();
  return s.includes("pending") || s.includes("verification");
}

// ✅ سرمایه‌گذاری واقعی برای سود/withdraw
function isInvestmentOrder(o) {
  return o?.orderType === "investment";
}

// ✅ خرید پلن (VIP/BASE/ADVANCED)
function isPlanOrder(o) {
  return o?.orderType === "plan";
}

function isApproved(o) {
  const s = String(o?.status || o?.statusText || "").toLowerCase();
  return s === "approved";
}

// ✅ helper های قفل ۲ ماهه + شمارش معکوس
function monthsDiff(fromDateLike) {
  if (!fromDateLike) return 0;
  const a = new Date(fromDateLike);
  const b = new Date();

  const diff =
    (b.getFullYear() - a.getFullYear()) * 12 +
    (b.getMonth() - a.getMonth());

  return diff;
}

function daysUntilTwoMonths(fromDateLike) {
  if (!fromDateLike) return null;
  const start = new Date(fromDateLike);
  const unlock = new Date(start);
  unlock.setDate(unlock.getDate() + 1);

  const ms = unlock.getTime() - Date.now();
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return days;
}

export default function Dashboard() {
  const router = useRouter();
  const { lang, dir, t, tv } = useLanguage();

  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);

  // Wallet per-user
  const [wallet, setWallet] = useState("");
  const [walletDraft, setWalletDraft] = useState("");
  const [walletSaved, setWalletSaved] = useState(false);

  // ✅ Ticket badge count (unread replies for user)
  const [ticketUnread, setTicketUnread] = useState(0);

  // ✅ Withdrawal modal state
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddr, setWithdrawAddr] = useState("");
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);

  // ✅ NEW: selected plan inside withdraw modal (BASE/ADVANCED/VIP)
  const [withdrawPlan, setWithdrawPlan] = useState(""); // "base" | "advanced" | "vip" | ""

  // ✅ CSRF token (اضافه شد)
  const [csrfToken, setCsrfToken] = useState("");

  // ✅ گرفتن CSRF (اضافه شد)
  async function ensureCsrf() {
    if (csrfToken) return csrfToken;

    const r = await fetch("/api/auth/csrf", {
      method: "GET",
      credentials: "include",
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.ok || !data?.csrfToken) {
      throw new Error("CSRF token not available");
    }

    const tok = String(data.csrfToken);
    setCsrfToken(tok);
    return tok;
  }

  // ✅ امن: یوزر از session (httpOnly cookie) میاد، نه localStorage
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // 1) me
        const res = await fetch("/api/auth/me", { credentials: "include" });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data?.ok || !data?.user?.email) {
          router.replace("/login");
          return;
        }

        if (!mounted) return;

        const u = data.user;
        setUser(u);

        // ✅ پیش‌فرض: CSRF رو هم از اول بگیر که هنگام save آماده باشه
        try {
          const r = await fetch("/api/auth/csrf", { method: "GET", credentials: "include" });
          const d = await r.json().catch(() => ({}));
          if (mounted && r.ok && d?.ok && d?.csrfToken) setCsrfToken(String(d.csrfToken));
        } catch {}

        // 2) orders/my
        try {
          const ordRes = await fetch("/api/auth/orders/my", { credentials: "include" });
          const ordData = await ordRes.json().catch(() => ({}));

          if (!mounted) return;

          if (ordRes.ok && ordData?.ok) {
            setOrders(Array.isArray(ordData.orders) ? ordData.orders : []);
          } else {
            setOrders([]);
          }
        } catch {
          if (!mounted) return;
          setOrders([]);
        }

        // load wallet
        const w = localStorage.getItem(`regorixa_wallet_${u.email}`) || "";
        setWallet(w);
        setWalletDraft(w);
      } catch {
        router.replace("/login");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  // ✅ Load ticket unread count when user is available (and refresh on route change)
  useEffect(() => {
    let cancelled = false;

    const loadUnread = async () => {
      try {
        if (!user?.email) {
          if (!cancelled) setTicketUnread(0);
          return;
        }

        const userId = String(user.email);
        const res = await fetch(`/api/tickets/unread-count?userId=${encodeURIComponent(userId)}`, {
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));

        if (cancelled) return;
        setTicketUnread(Number(data?.count || 0));
      } catch {
        if (!cancelled) setTicketUnread(0);
      }
    };

    loadUnread();

    return () => {
      cancelled = true;
    };
  }, [user?.email, router.asPath]);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}

    try {
      localStorage.removeItem("regorixa_current_user");
    } catch {}

    router.push("/login");
  }

  async function saveWallet() {
    if (!user?.email) return;

    const v = walletDraft.trim();
    if (!v) {
      alert(t("dashboard.wallet.alertEnter", "Please enter your USDT (TRC20) wallet address."));
      return;
    }
    if (!isLikelyTrc20Address(v)) {
      alert(
        t(
          "dashboard.wallet.alertInvalid",
          "Wallet address format doesn't look like TRC20 (TRON). Please double-check."
        )
      );
      return;
    }

    try {
      localStorage.setItem(`regorixa_wallet_${user.email}`, v);
    } catch {}

    try {
      const token = await ensureCsrf();

      await fetch("/api/wallet/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        credentials: "include",
        body: JSON.stringify({ wallet: v }),
      });
    } catch {}

    setWallet(v);
    setWalletSaved(true);
    setTimeout(() => setWalletSaved(false), 1800);
    alert(t("dashboard.wallet.alertSaved", "Wallet saved successfully."));
  }

  function scrollToId(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openTickets() {
    router.push("/tickets");
  }

  // ✅ Withdrawal eligibility: فقط روی investment approved
  const withdrawalInfo = useMemo(() => {
    const approvedInvestments = orders.filter(
      (o) => isApproved(o) && isInvestmentOrder(o)
    );

    if (approvedInvestments.length === 0) {
      return {
        eligible: false,
        since: null,
        daysLeft: null,
        investedTotal: 0,
        reason: "no_investment",
      };
    }

    const firstInvestment = approvedInvestments
      .slice()
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];

    const investedTotal = approvedInvestments.reduce(
      (sum, o) => sum + Number(o?.amount || 0),
      0
    );

    const m = monthsDiff(firstInvestment.createdAt);
    const eligible = m >= 2;
    const daysLeft = eligible ? 0 : daysUntilTwoMonths(firstInvestment.createdAt);

    return {
      eligible,
      since: firstInvestment.createdAt,
      daysLeft,
      investedTotal,
      reason: eligible ? "ok" : "too_early",
    };
  }, [orders]);

  // ✅ NEW: سرمایه‌گذاری تایید شده بر اساس پلن (برای دکمه‌های BASE/ADVANCED/VIP)
  const investedByPlan = useMemo(() => {
    const map = { base: 0, advanced: 0, vip: 0 };

    const approvedInvestments = orders.filter((o) => isApproved(o) && isInvestmentOrder(o));
    for (const o of approvedInvestments) {
      const p = String(o?.plan || "").toLowerCase();
      const amt = Number(o?.amount || 0);
      if (!Number.isFinite(amt) || amt <= 0) continue;

      if (p === "base") map.base += amt;
      else if (p === "advanced") map.advanced += amt;
      else if (p === "vip") map.vip += amt;
    }

    return map;
  }, [orders]);

  function pickWithdrawPlan(planKey) {
    const p = String(planKey || "").toLowerCase();
    const amt = Number(investedByPlan[p] || 0);

    setWithdrawPlan(p);
    // طبق درخواست شما: مبلغ دستی نباشه و با کلیک روی پلن، همون سرمایه‌گذاری رو بذاره
    setWithdrawAmount(amt > 0 ? String(amt) : "");
  }

  function openWithdraw() {
    setWithdrawAddr(walletDraft || wallet || "");
    setWithdrawAmount("");
    setWithdrawPlan("");
    setWithdrawOpen(true);

    // UX بهتر: اگر فقط یک پلن سرمایه‌گذاری تایید شده دارد، خودکار انتخاب شود
    const available = ["base", "advanced", "vip"].filter((p) => Number(investedByPlan[p] || 0) > 0);
    if (available.length === 1) {
      pickWithdrawPlan(available[0]);
    }
  }

  function closeWithdraw() {
    setWithdrawOpen(false);
    setWithdrawSubmitting(false);
  }

  async function submitWithdraw() {
    if (!withdrawalInfo.eligible) {
      alert(
        t(
          "withdraw.alertTooEarly",
          `You can request a withdrawal after 2 months. Days left: ${withdrawalInfo.daysLeft ?? "-"}`
        )
      );
      return;
    }

    // ✅ NEW: باید پلن انتخاب شود (چون مبلغ دستی نیست)
    if (!withdrawPlan) {
      alert(t("withdraw.alertPickPlan", "Please select your plan (BASE/ADVANCED/VIP)."));
      return;
    }

    const amt = Number(String(withdrawAmount || "").trim());
    const addr = String(withdrawAddr || "").trim();

    if (!Number.isFinite(amt) || amt <= 0) {
      alert(t("withdraw.alertInvalidAmount", "Please enter a valid amount."));
      return;
    }

    if (withdrawalInfo.investedTotal > 0 && amt > withdrawalInfo.investedTotal) {
      alert(t("withdraw.alertTooMuch", "Amount exceeds your invested capital."));
      return;
    }

    if (!isLikelyTrc20Address(addr)) {
      alert(t("withdraw.alertInvalidAddr", "Please enter a valid USDT (TRC20) address."));
      return;
    }

    setWithdrawSubmitting(true);

    try {
      const token = await ensureCsrf();

      const res = await fetch("/api/withdrawals/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        credentials: "include",
        body: JSON.stringify({
          amount: amt,
          walletAddress: addr,
          // نکته: شرط‌ها عوض نشده. این فیلد اضافی هم نمی‌فرستم تا بک‌اندت تغییر نخواد.
          // اگر بعداً خواستی، می‌تونیم plan هم بفرستیم.
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        alert(String(data?.error || "Request failed"));
        setWithdrawSubmitting(false);
        return;
      }

      alert(
        t(
          "withdraw.alertSubmitted",
          "Withdrawal request submitted. You will be notified by email within 24 hours."
        )
      );
      closeWithdraw();
    } catch (e) {
      alert(t("withdraw.alertFailed", "Request failed. Please try again."));
      setWithdrawSubmitting(false);
    }
  }

  // ✅ آخرین سفارش (plan یا investment)
  const latestOrder = useMemo(() => {
    if (!orders.length) return null;
    const sorted = orders
      .slice()
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    return sorted[sorted.length - 1];
  }, [orders]);

  // ✅ Active Plan (VIP/BASE/ADVANCED) از orderType=plan
  const approvedPlanOrdersSorted = useMemo(() => {
    return orders
      .filter((o) => isApproved(o) && isPlanOrder(o))
      .slice()
      .sort(
        (a, b) =>
          new Date(b.createdAt || b.updatedAt || 0) -
          new Date(a.createdAt || a.updatedAt || 0)
      );
  }, [orders]);

  const activePlanOrder = approvedPlanOrdersSorted[0] || null;

  // ✅ Active Investment از orderType=investment (برای Plan status / Profit / Withdraw)
  const approvedInvestmentsSorted = useMemo(() => {
    return orders
      .filter((o) => isApproved(o) && isInvestmentOrder(o))
      .slice()
      .sort(
        (a, b) =>
          new Date(b.investmentStartedAt || b.createdAt || b.updatedAt || 0) -
          new Date(a.investmentStartedAt || a.createdAt || a.updatedAt || 0)
      );
  }, [orders]);

  const activeInvestmentOrder = approvedInvestmentsSorted[0] || null;

  // ✅ Plan status: ۲ سرمایه‌گذاری تایید شده آخر
  const planStatusOrders = useMemo(() => {
    if (!approvedInvestmentsSorted.length) return [];
    return approvedInvestmentsSorted.slice(0, 2);
  }, [approvedInvestmentsSorted]);

  // ✅ Pending فقط برای سرمایه‌گذاری‌ها
  const latestPending = useMemo(() => {
    const pendings = orders
      .filter((o) => isInvestmentOrder(o) && isPendingStatus(o?.status))
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return pendings[0] || null;
  }, [orders]);

  const latestPendingEta = useMemo(() => {
    if (!latestPending) return null;
    return ensureEta(latestPending);
  }, [latestPending]);

  if (!user) return null;

  const now = Date.now();
  const pendingMaxAtMs = latestPendingEta?.etaMaxAt ? new Date(latestPendingEta.etaMaxAt).getTime() : null;
  const pendingIsDelayed = pendingMaxAtMs ? now > pendingMaxAtMs : false;

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Head>
        <meta name="robots" content="noindex,nofollow" />
        <title>Dashboard | REGORIXA</title>
      </Head>

      <Nav />

      {/* Header */}
      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">{t("dashboard.tag", "Dashboard")}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {t("dashboard.tagline", "Profile • Orders • Profits")}
          </span>
        </div>

        <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.2 }}>
          {t("dashboard.welcomePrefix", "Welcome,")} {user.firstName || user.email} 👋
        </h1>

        <p className="p" style={{ marginTop: 10, marginBottom: 0 }}>
          {t("dashboard.intro", "Manage your account, view orders, and track monthly profit payments.")}
        </p>

        {/* ✅ ETA فقط برای Pending سرمایه‌گذاری */}
        {latestPending && latestPendingEta && (
          <div
            className={pendingIsDelayed ? "warning" : "muted"}
            style={{
              fontSize: 12,
              marginTop: 12,
              padding: pendingIsDelayed ? 10 : 0,
              borderRadius: pendingIsDelayed ? 10 : 0,
            }}
          >
            <b>{t("dashboard.pendingInvestment", "Pending investment:")}</b>{" "}
            {(latestPending.plan || "").toUpperCase()} •{" "}
            {latestPending.status || t("dashboard.pendingVerification", "Pending verification")}
            {" • "}
            <span>
              {t("dashboard.estimatedApproval", "Estimated approval:")}{" "}
              <b>{latestPendingEta.etaText}</b>
            </span>
            {pendingMaxAtMs && (
              <>
                {" • "}
                {t("dashboard.expectedBy", "Expected by:")}{" "}
                <b>{formatDateTime(pendingMaxAtMs, lang)}</b>
              </>
            )}
            {pendingMaxAtMs && (
              <>
                {" • "}
                {pendingIsDelayed ? (
                  <b>{t("dashboard.delayed", "Delayed")}</b>
                ) : (
                  <>
                    {t("dashboard.timeLeft", "Time left:")}{" "}
                    <b>{formatRemaining(pendingMaxAtMs - now)}</b>
                  </>
                )}
              </>
            )}
          </div>
        )}

        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btnGhost" onClick={handleLogout} type="button">
            {t("dashboard.logout", "Logout")}
          </button>

          {/* ✅ My Plan: از روی پلن تایید شده (orderType=plan) */}
          <button
            className={`btnPrimary ${activePlanOrder ? "" : "btnDisabled"}`}
            type="button"
            onClick={() => {
              if (!activePlanOrder) {
                alert(
                  t(
                    "dashboard.alertNoPlanYet",
                    "You don’t have an approved plan yet. Please purchase a plan first or wait for admin approval."
                  )
                );
                return;
              }
              const p = String(activePlanOrder.plan || "base").toLowerCase();
              window.location.href =
                p === "advanced" ? "/plans/advanced" : p === "vip" ? "/plans/vip" : "/plans/base";
            }}
          >
            {t("dashboard.myPlan", "My Plan")} →
          </button>

          <button className="btnGhost" type="button" onClick={() => scrollToId("walletSection")}>
            {t("dashboard.myWallet", "My Wallet")}
          </button>

          <button className="btnGhost" type="button" onClick={() => scrollToId("accountSection")}>
            {t("dashboard.myAccount", "My Account")}
          </button>

          <button className="btnGhost" type="button" onClick={() => router.push("/security")}>
            {t("dashboard.security", "Security")}
          </button>

          <button
            className="btnGhost"
            type="button"
            onClick={openWithdraw}
            title={t("withdraw.titleOk", "Request withdrawal")}
          >
            {t("withdraw.btn", "Withdraw")}
          </button>

          <button
            className="btnGhost"
            type="button"
            onClick={openTickets}
            style={{ position: "relative" }}
            aria-label="Tickets"
            title="Tickets"
          >
            Ticket
            {ticketUnread > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  minWidth: 18,
                  height: 18,
                  padding: "0 5px",
                  borderRadius: 999,
                  fontSize: 12,
                  lineHeight: "18px",
                  textAlign: "center",
                  background: "#e53935",
                  color: "#fff",
                }}
              >
                {ticketUnread}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ✅ Desktop: Plan status + Profit history کنار هم */}
      <div className="twoCol" style={{ marginTop: 18 }}>
        {/* Plan status */}
        <div className="sectionBox" style={{ marginTop: 0 }}>
          <h3 style={{ marginTop: 0 }}>{t("dashboard.planStatus.title", "Plan status")}</h3>

          {planStatusOrders.length === 0 ? (
            <div className="muted" style={{ fontSize: 14 }}>
              {t("dashboard.planStatus.empty", "No active investment yet.")}
            </div>
          ) : (
            <div className="statusTwoCols">
              {planStatusOrders.map((ord) => {
                const nextProfitDate = getNextProfitDateFromOrder(ord);
                const nextPlusOneProfitDate = getNextPlusOne(nextProfitDate);

                const profits = Array.isArray(ord.profits) ? ord.profits : [];
                const paidCount = profits.filter((p) => p.paid).length;

                const paidTotal = profits
                  .filter((p) => p.paid)
                  .reduce((sum, p) => sum + Number(p?.amount || 0), 0);

                return (
                  <div key={`${ord.plan}-${ord.createdAt}`} className="statusCard">
                    <div className="statusCardTop">
                      <div className="cellStrong">{(ord.plan || "").toUpperCase()}</div>
                      <span className="statusOk">{t("dashboard.planStatus.active", "Active")}</span>
                    </div>

                    <div className="statusGrid">
                      <div className="profileItem">
                        <div className="muted">{t("dashboard.planStatus.nextProfitDate", "Next profit date")}</div>
                        <div className="profileValue">{formatDate(nextProfitDate, lang)}</div>
                      </div>

                      <div className="profileItem">
                        <div className="muted">{t("dashboard.planStatus.nextPlusOne", "Next +1 profit date")}</div>
                        <div className="profileValue">{formatDate(nextPlusOneProfitDate, lang)}</div>
                      </div>

                      <div className="profileItem">
                        <div className="muted">{t("dashboard.planStatus.investedAmount", "Invested amount")}</div>
                        <div className="profileValue">{ord.amount ? `${ord.amount} USDT` : "-"}</div>
                      </div>

                      <div className="profileItem">
                        <div className="muted">{t("dashboard.planStatus.paidProfits", "Paid profits")}</div>
                        <div className="profileValue">
                          {paidTotal ? `${paidTotal} USDT` : `0 USDT`}
                          <span className="muted" style={{ fontSize: 12, marginInlineStart: 8 }}>
                            ({paidCount})
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ✅ Latest submission: واضح که plan بوده یا investment */}
          {latestOrder ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              {t("dashboard.latestSubmission", "Latest submission:")}{" "}
              {(latestOrder.plan || "").toUpperCase()} •{" "}
              {latestOrder.status || t("dashboard.pendingVerification", "Pending verification")} •{" "}
              <span className="muted">{latestOrder.orderType || "-"}</span>
            </div>
          ) : null}
        </div>

        {/* Profit history */}
        <div className="sectionBox" style={{ marginTop: 0 }}>
          <h3 style={{ marginTop: 0 }}>{t("dashboard.profitHistory.title", "Profit history")}</h3>

          {planStatusOrders.length === 0 ? (
            <div className="muted" style={{ fontSize: 14 }}>
              {t("dashboard.planStatus.empty", "No active investment yet.")}
            </div>
          ) : (
            <div className="profitTwoCols">
              {planStatusOrders.map((ord) => {
                const profits = Array.isArray(ord.profits) ? ord.profits : [];

                return (
                  <div key={`profits-${ord.plan}-${ord.createdAt}`} className="profitCard">
                    <div className="profitCardTop">
                      <div className="cellStrong">{(ord.plan || "").toUpperCase()}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {t("dashboard.profitHistory.invested", "Invested:")} {ord.amount} USDT
                      </div>
                    </div>

                    {profits.length === 0 ? (
                      <div className="muted" style={{ fontSize: 14 }}>
                        {t(
                          "dashboard.profitHistory.empty",
                          "No profits recorded yet. Admin will pay monthly profits."
                        )}
                      </div>
                    ) : (
                      <div className="tableWrap">
                        <table className="table tableFixed">
                          <thead>
                            <tr>
                              <th style={{ width: 120 }}>{t("dashboard.profitHistory.month", "Month")}</th>
                              <th style={{ width: 160 }}>{t("dashboard.profitHistory.dueDate", "Due date")}</th>
                              <th style={{ width: 120 }}>{t("dashboard.profitHistory.status", "Status")}</th>
                              <th>{t("dashboard.profitHistory.paidAt", "Paid at")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {profits.map((p) => (
                              <tr key={`${ord.plan}-m${p.month}`}>
                                <td className="cellStrong">
                                  {t("dashboard.profitHistory.monthLabel", "Month")} {p.month}
                                </td>
                                <td>{formatDate(p.dueAt, lang)}</td>
                                <td>
                                  {p.paid ? (
                                    <span className="statusOk">{t("dashboard.profitHistory.paid", "Paid")}</span>
                                  ) : (
                                    <span className="statusPending">{t("dashboard.profitHistory.unpaid", "Unpaid")}</span>
                                  )}
                                </td>
                                <td>{formatDateTime(p.paidAt, lang)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ✅ Wallet Section */}
      <div id="walletSection" className="sectionBox" style={{ marginTop: 18 }}>
        <div className="sectionHeaderRow">
          <h3 style={{ margin: 0 }}>{t("dashboard.wallet.title", "My wallet")}</h3>
          <span className="muted" style={{ fontSize: 12 }}>
            {t("dashboard.wallet.subtitle", "USDT (TRC20) payout address")}
          </span>
        </div>

        <div className="walletBox" style={{ marginTop: 12 }}>
          <div className="walletLabel">{t("dashboard.wallet.label", "Wallet address")}</div>

          <div className="walletRow">
            <input
              className="input"
              placeholder={t("dashboard.wallet.placeholder", "Enter TRC20 wallet address (starts with T...)")}
              value={walletDraft}
              onChange={(e) => setWalletDraft(e.target.value)}
            />

            <button className="btnPrimary" onClick={saveWallet} type="button">
              {t("dashboard.wallet.save", "Save")}
            </button>
          </div>

          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            {t("dashboard.wallet.savedAddress", "Saved address:")}
          </div>
          <div className="txBox" style={{ marginTop: 8 }}>
            {wallet ? wallet : t("dashboard.wallet.notSet", "Not set yet.")}
          </div>
        </div>
      </div>

      {/* ✅ Account Section */}
      <div id="accountSection" className="sectionBox" style={{ marginTop: 18 }}>
        <div className="sectionHeaderRow">
          <h3 style={{ margin: 0 }}>{t("dashboard.account.title", "My account")}</h3>
          <span className="muted" style={{ fontSize: 12 }}>
            {t("dashboard.account.subtitle", "Your registration info")}
          </span>
        </div>

        <div className="profileGrid" style={{ marginTop: 12 }}>
          <div className="profileItem">
            <div className="muted">{t("dashboard.account.firstName", "First name")}</div>
            <div className="profileValue">{user.firstName || "-"}</div>
          </div>

          <div className="profileItem">
            <div className="muted">{t("dashboard.account.lastName", "Last name")}</div>
            <div className="profileValue">{user.lastName || "-"}</div>
          </div>

          <div className="profileItem">
            <div className="muted">{t("dashboard.account.email", "Email")}</div>
            <div className="profileValue">{user.email || "-"}</div>
          </div>

          <div className="profileItem">
            <div className="muted">{t("dashboard.account.registeredAt", "Registered at")}</div>
            <div className="profileValue">{formatDateTime(user.createdAt, lang)}</div>
          </div>
        </div>
      </div>

      {/* Transactions */}
      <div className="sectionBox" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>{t("dashboard.transactions.title", "My transactions")}</h3>

        {orders.length === 0 ? (
          <div className="muted" style={{ fontSize: 14 }}>
            {t("dashboard.transactions.empty", "No transactions yet.")}
          </div>
        ) : (
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("dashboard.transactions.table.plan", "Plan")}</th>
                  <th>{t("dashboard.transactions.table.amount", "Amount")}</th>
                  <th>{t("dashboard.transactions.table.date", "Date")}</th>
                  <th>{t("dashboard.transactions.table.status", "Status")}</th>
                  <th>{t("dashboard.transactions.table.type", "Type")}</th>
                </tr>
              </thead>
              <tbody>
                {orders
                  .slice()
                  .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
                  .map((o, i) => {
                    const pending = isPendingStatus(o?.status);
                    const eta = pending ? ensureEta(o) : null;
                    const maxAtMs = eta?.etaMaxAt ? new Date(eta.etaMaxAt).getTime() : null;
                    const delayed = pending && maxAtMs ? now > maxAtMs : false;

                    const statusLabel =
                      o.status === "Approved"
                        ? t("dashboard.status.approved", "Approved")
                        : o.status === "Rejected"
                        ? t("dashboard.status.rejected", "Rejected")
                        : o.status || t("dashboard.pendingVerification", "Pending verification");

                    return (
                      <tr key={`${o.txid || o.id || "tx"}-${i}`}>
                        <td className="cellStrong">{(o.plan || "").toUpperCase()}</td>
                        <td>{o.amount ? `${o.amount} USDT` : "-"}</td>
                        <td>{formatDate(o.createdAt, lang)}</td>
                        <td>
                          <span
                            className={
                              o.status === "Approved"
                                ? "statusOk"
                                : o.status === "Rejected"
                                ? "statusBad"
                                : "statusPending"
                            }
                          >
                            {statusLabel}
                          </span>

                          {pending && eta ? (
                            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                              {t("dashboard.estimatedApproval", "Estimated approval:")} <b>{eta.etaText}</b>
                              {maxAtMs ? (
                                <>
                                  {" • "}
                                  {t("dashboard.expectedBy", "Expected by:")}{" "}
                                  <b>{formatDateTime(maxAtMs, lang)}</b>
                                  {" • "}
                                  {delayed ? (
                                    <b>{t("dashboard.delayed", "Delayed")}</b>
                                  ) : (
                                    <>
                                      {t("dashboard.timeLeft", "Time left:")}{" "}
                                      <b>{formatRemaining(maxAtMs - now)}</b>
                                    </>
                                  )}
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {o.orderType || t("dashboard.orderType.plan", "plan")}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ✅ Withdraw modal */}
      {withdrawOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
          onClick={closeWithdraw}
        >
          <div
            className="glass"
            style={{
              width: "min(720px, 100%)",
              padding: 18,
              borderRadius: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <h3 style={{ margin: 0 }}>{t("withdraw.modalTitle", "Request withdrawal")}</h3>
              <button className="btnGhost" type="button" onClick={closeWithdraw}>
                {t("common.close", "Close")}
              </button>
            </div>

            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {t("withdraw.note24h", "You will be notified by email within 24 hours.")}
            </div>

            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {t(
                "withdraw.rule",
                "Withdrawal requests are available after 2 months from the start of your investment."
              )}
            </div>

            {withdrawalInfo.since && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {t("withdraw.investedSince", "Investment started at:")}{" "}
                <b>{formatDate(withdrawalInfo.since, lang)}</b>
                {!withdrawalInfo.eligible && (
                  <>
                    {" • "}
                    {t("withdraw.daysLeft", "Days left:")} <b>{withdrawalInfo.daysLeft ?? "-"}</b>
                  </>
                )}
              </div>
            )}

            {/* ✅ layout: left form + right plan buttons */}
            <div style={{ marginTop: 14, display: "flex", gap: 16, alignItems: "stretch", flexWrap: "wrap" }}>
              {/* Left: inputs */}
              <div style={{ flex: "1 1 420px", display: "grid", gap: 10 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                    {t("withdraw.amountLabel", "Amount (USDT)")}
                  </div>
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder={t("withdraw.amountPh", "Select plan")}
                    value={withdrawAmount}
                    readOnly
                    // طبق درخواست: تایپ دستی ممنوع
                    onChange={() => {}}
                    style={{
                      opacity: withdrawAmount ? 1 : 0.8,
                      cursor: "not-allowed",
                    }}
                  />
                  {!withdrawPlan && (
                    <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                      {t("withdraw.pickPlanHint", "Select your plan on the right to auto-fill the amount.")}
                    </div>
                  )}
                </div>

                <div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                    {t("withdraw.addrLabel", "USDT (TRC20) wallet address")}
                  </div>
                  <input
                    className="input"
                    placeholder={t("withdraw.addrPh", "Starts with T...")}
                    value={withdrawAddr}
                    onChange={(e) => setWithdrawAddr(e.target.value)}
                  />
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button className="btnGhost" type="button" onClick={closeWithdraw} disabled={withdrawSubmitting}>
                    {t("common.cancel", "Cancel")}
                  </button>

                  <button
                    className={`btnPrimary ${withdrawSubmitting ? "btnDisabled" : ""}`}
                    type="button"
                    onClick={submitWithdraw}
                    disabled={withdrawSubmitting}
                  >
                    {withdrawSubmitting ? t("withdraw.submitting", "Submitting...") : t("withdraw.submit", "Submit request")}
                  </button>
                </div>
              </div>

              {/* Right: plan buttons */}
              <div style={{ flex: "0 0 150px", display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  type="button"
                  className={`planPickBtn ${withdrawPlan === "base" ? "active" : ""}`}
                  disabled={Number(investedByPlan.base || 0) <= 0}
                  onClick={() => pickWithdrawPlan("base")}
                  title={Number(investedByPlan.base || 0) > 0 ? `Invested: ${investedByPlan.base} USDT` : "No investment"}
                >
                  BASE
                </button>

                <button
                  type="button"
                  className={`planPickBtn ${withdrawPlan === "advanced" ? "active" : ""}`}
                  disabled={Number(investedByPlan.advanced || 0) <= 0}
                  onClick={() => pickWithdrawPlan("advanced")}
                  title={Number(investedByPlan.advanced || 0) > 0 ? `Invested: ${investedByPlan.advanced} USDT` : "No investment"}
                >
                  ADVANCED
                </button>

                <button
                  type="button"
                  className={`planPickBtn ${withdrawPlan === "vip" ? "active" : ""}`}
                  disabled={Number(investedByPlan.vip || 0) <= 0}
                  onClick={() => pickWithdrawPlan("vip")}
                  title={Number(investedByPlan.vip || 0) > 0 ? `Invested: ${investedByPlan.vip} USDT` : "No investment"}
                >
                  VIP
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ height: 26 }} />
    </div>
  );
}
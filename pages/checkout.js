import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Nav from "../components/Nav";
import { useLanguage } from "../context/LanguageContext";
import translations from "../translations";

// ✅ Approx approval window
const APPROVAL_WINDOW_HOURS = { min: 1, max: 6 };

function normalizePlan(p) {
  const s = String(p || "").toLowerCase();
  if (s === "adv") return "advanced";
  if (s === "basic") return "base";
  return s;
}

// ✅ TRON Tx hash: usually 64 hex chars (with/without 0x)
function normalizeTxId(txid) {
  const s = String(txid || "").trim();
  if (!s) return "";
  return s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
}
function isValidTxId(txid) {
  const s = normalizeTxId(txid);
  if (!s) return false;
  return /^[0-9a-fA-F]{64}$/.test(s);
}

/**
 * ✅ معیار شما برای حذف FREE:
 * کاربر اگر حتی یک سرمایه‌گذاری ثبت کرده باشد (حتی Pending) دیگر FREE نبیند.
 *
 * سرمایه‌گذاری یعنی:
 * - orderType === "investment" و amount > 0
 * - یا (سازگاری با دیتای قدیمی) orderType === "plan" یا خالی و amount > 0
 *
 * به جز حالت‌هایی که rejected / cancelled هستند.
 */
function userHasAnyInvestment(list, email) {
  return (Array.isArray(list) ? list : []).some((o) => {
    const sameUser =
      String(o?.userEmail || "").toLowerCase() === String(email || "").toLowerCase();
    if (!sameUser) return false;

    const amount = Number(o?.amount || 0);
    if (!(amount > 0)) return false;

    const type = String(o?.orderType || "").toLowerCase();

    const status = String(o?.status || "").toLowerCase();
    const statusText = String(o?.statusText || "").toLowerCase();
    const s = `${status} ${statusText}`.trim();

    // رد یا کنسل = سرمایه‌گذاری حساب نشه
    if (s.includes("rejected") || s.includes("reject") || s.includes("cancel")) return false;

    // سرمایه‌گذاری جدید
    if (type === "investment") return true;

    // سازگاری با دیتای قدیمی: بعضی پروژه‌ها investment را plan ذخیره می‌کردند
    if (type === "plan" || !type) return true;

    return false;
  });
}

// notice helper
function makeNotice(type, title, text, options = {}) {
  return {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type, // "success" | "error" | "info"
    title,
    text,
    autoHideMs: options.autoHideMs ?? null, // null => no auto hide
  };
}

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
    else return undefined;
  }
  return cur;
}

export default function Checkout() {
  const router = useRouter();
  const { lang, dir } = useLanguage();

  // ✅ t() supports dotted, flat, and nested checkout namespace
  const t = useMemo(() => {
    const enPack = translations.en || {};
    const curPack = translations[lang] || enPack;

    function resolve(pack, key) {
      if (!pack) return undefined;

      // 1) dotted path: "checkout.tag"
      if (String(key).includes(".")) {
        const v = getByPath(pack, key);
        if (typeof v === "string" && v.length) return v;
      }

      // 2) flat at root
      const flat = pack?.[key];
      if (typeof flat === "string" && flat.length) return flat;

      // 3) nested checkout namespace
      const ns = pack?.checkout?.[key];
      if (typeof ns === "string" && ns.length) return ns;

      return undefined;
    }

    return (key, fallback = "") => {
      const v1 = resolve(curPack, key);
      if (v1 !== undefined) return v1;

      const v2 = resolve(enPack, key);
      if (v2 !== undefined) return v2;

      return fallback;
    };
  }, [lang]);

  const plan = normalizePlan(router.query.plan);

  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);

  const [txid, setTxid] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [eligibleFree, setEligibleFree] = useState(false);
  const [copied, setCopied] = useState(false);

  const [wallet, setWallet] = useState("");
  const [walletLoading, setWalletLoading] = useState(false);

  const [notice, setNotice] = useState(null);
  const noticeTimerRef = useRef(null);
  const noticeRef = useRef(null);
  const retryRef = useRef(null);

  function clearNotice() {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    retryRef.current = null;
    setNotice(null);
  }

  function showNotice(next, retryFn = null) {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }

    retryRef.current = typeof retryFn === "function" ? retryFn : null;
    setNotice(next);

    setTimeout(() => {
      if (noticeRef.current) {
        noticeRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 0);

    if (next?.autoHideMs) {
      noticeTimerRef.current = setTimeout(() => {
        setNotice((cur) => (cur?.id === next.id ? null : cur));
        if (retryRef.current) retryRef.current = null;
        noticeTimerRef.current = null;
      }, next.autoHideMs);
    }
  }

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const planMeta = useMemo(() => {
    if (plan === "advanced")
      return {
        titleKey: "checkoutAdvancedTitle",
        titleFallback: "Advanced Plan",
        crumbKey: "checkoutCrumbAdvanced",
        crumbFallback: "Advanced Plan • Pay with USDT (TRC20) • Submit TxID",
        fixedAmount: 200,
        fee: 300,
        networkLabelKey: "checkoutUsdtTrc20",
        networkLabelFallback: "USDT (TRC20)",
        introKey: "checkoutIntroAdvanced",
        introFallback:
          "Send 200 USDT to the wallet below, then submit your TxID. After admin approval, your plan activates.",
        sendExactKey: "checkoutSendExactAdvanced",
        sendExactFallback:
          "Send exactly 200 USDT on TRC20 to this address. Sending other assets/networks may result in loss of funds.",
        amountHintKey: "checkoutAmountHintAdvanced",
        amountHintFallback: "This amount is fixed for Advanced Plan.",
      };

    if (plan === "base")
      return {
        titleKey: "checkoutBaseTitle",
        titleFallback: "Base Plan",
        crumbKey: "checkoutCrumbBase",
        crumbFallback: "Base Plan • Pay with USDT (TRC20) • Submit TxID",
        fixedAmount: 100,
        fee: 100,
        networkLabelKey: "checkoutUsdtTrc20",
        networkLabelFallback: "USDT (TRC20)",
        introKey: "checkoutIntroBase",
        introFallback:
          "Send 100 USDT to the wallet below, then submit your TxID. After admin approval, your plan activates.",
        sendExactKey: "checkoutSendExactBase",
        sendExactFallback:
          "Send exactly 100 USDT on TRC20 to this address. Sending other assets/networks may result in loss of funds.",
        amountHintKey: "checkoutAmountHintBase",
        amountHintFallback: "This amount is fixed for Base Plan.",
      };

    if (plan === "vip")
      return {
        titleKey: "checkoutVipTitle",
        titleFallback: "VIP Plan",
        crumbKey: "checkoutCrumbVip",
        crumbFallback: "VIP Plan • Pay with USDT (TRC20) • Submit TxID",
        fixedAmount: 1000,
        fee: 1000,
        networkLabelKey: "checkoutUsdtTrc20",
        networkLabelFallback: "USDT (TRC20)",
        introKey: "checkoutIntroVip",
        introFallback:
          "Send 1000 USDT to the wallet below, then submit your TxID. After admin approval, your plan activates.",
        sendExactKey: "checkoutSendExactVip",
        sendExactFallback:
          "Send exactly 1000 USDT on TRC20 to this address. Sending other assets/networks may result in loss of funds.",
        amountHintKey: "checkoutAmountHintVip",
        amountHintFallback: "This amount is fixed for VIP Plan.",
      };

    return null;
  }, [plan]);

  // ✅ user from session
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok || !data?.user?.email) {
          router.replace("/login");
          return;
        }
        if (!mounted) return;
        setUser(data.user);
      } catch {
        router.replace("/login");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  // ✅ orders
  useEffect(() => {
    if (!user?.email) return;

    let mounted = true;

    (async () => {
      try {
        const ordRes = await fetch("/api/auth/orders/my");
        const ordData = await ordRes.json().catch(() => ({}));

        if (!mounted) return;

        if (ordRes.ok && ordData?.ok) {
          setOrders(Array.isArray(ordData.orders) ? ordData.orders : []);
        } else {
          setOrders([]);
        }
      } catch {
        if (mounted) setOrders([]);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [user?.email]);

  // ✅ wallet from server
  useEffect(() => {
    if (!planMeta) return;
    let mounted = true;

    (async () => {
      setWalletLoading(true);
      try {
        const res = await fetch(`/api/public/wallets?plan=${encodeURIComponent(plan)}`);
        const data = await res.json().catch(() => ({}));
        if (!mounted) return;
        if (res.ok && data?.ok) setWallet(String(data.wallet || ""));
        else setWallet("");
      } catch {
        if (mounted) setWallet("");
      } finally {
        if (mounted) setWalletLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [planMeta, plan]);

  // ✅ eligibility: FREE only before first investment (even pending)
  useEffect(() => {
    if (!user?.email || !planMeta) return;

    // اگر پلن plan-type شما Approved شد، برگرد به صفحه پلن
    const hasApprovedPlan = orders.some((o) => {
      const sameUser =
        String(o?.userEmail || "").toLowerCase() === String(user.email).toLowerCase();
      const p = String(o?.plan || "").toLowerCase();
      const st = String(o?.status || o?.statusText || "");
      const type = String(o?.orderType || "").toLowerCase();
      return sameUser && p === String(plan).toLowerCase() && st === "Approved" && type === "plan";
    });

    if (hasApprovedPlan) {
      router.replace(plan === "advanced" ? "/plans/advanced" : plan === "vip" ? "/plans/vip" : "/plans/base");
      return;
    }

    const hasInv = userHasAnyInvestment(orders, user.email);

    // ✅ فقط Base
    setEligibleFree(plan === "base" && !hasInv);
  }, [user?.email, plan, planMeta, router, orders]);

  // ✅ clear error notice when txid changes
  useEffect(() => {
    if (!notice) return;
    if (notice.type !== "error") return;
    clearNotice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txid]);

  async function copyWallet() {
    try {
      if (!wallet) return;
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);

      showNotice(
        makeNotice(
          "success",
          t("checkoutCopiedTitle", "Copied"),
          t("checkoutCopiedText", "Wallet address copied to clipboard."),
          { autoHideMs: 1800 }
        )
      );
    } catch {
      showNotice(
        makeNotice(
          "error",
          t("checkoutCopyFailedTitle", "Copy failed"),
          t("checkoutCopyFailedText", "Could not copy wallet address.")
        )
      );
    }
  }

  if (!planMeta) {
    return (
      <div className="container" dir={dir}>
        <Nav />
        <div className="sectionBox" style={{ marginTop: 18 }}>
          <h3 style={{ marginTop: 0 }}>{t("checkoutTag", "Checkout")}</h3>
          <div className="muted">
            {t("checkoutInvalidPlan", "Invalid plan. Go back and choose a plan.")}
          </div>
        </div>
      </div>
    );
  }

  const isWalletReady = !!wallet && !walletLoading;
  const txidLooksValid = isValidTxId(txid);
  const canSubmitPaid = !submitting && isWalletReady;
  const canClaimFree = !submitting;

  async function submitPaid() {
    if (!user?.email) return;
    if (submitting) return;

    clearNotice();

    const trimmed = String(txid || "").trim();
    if (!isValidTxId(trimmed)) {
      showNotice(
        makeNotice(
          "error",
          t("checkoutInvalidTxTitle", "Invalid TxID"),
          t("checkoutInvalidTxText", "TxID must be a 64-character hex hash (with or without 0x).")
        )
      );
      return;
    }

    setSubmitting(true);
    showNotice(
      makeNotice(
        "info",
        t("checkoutSubmittingTitle", "Submitting…"),
        t("checkoutSubmittingText", "Sending your transaction for review."),
        { autoHideMs: 2500 }
      )
    );

    try {
      const res = await fetch("/api/auth/orders/create-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, txid: trimmed }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        showNotice(
          makeNotice(
            "error",
            t("checkoutSubmitFailedTitle", "Submit failed"),
            data?.error || t("checkoutSubmitFailedText", "Failed to submit.")
          ),
          () => submitPaid()
        );
        return;
      }

      showNotice(
        makeNotice(
          "success",
          t("checkoutSubmittedTitle", "Submitted"),
          t("checkoutSubmittedText", "Submitted successfully. Waiting for admin approval… Redirecting to dashboard."),
          { autoHideMs: 4500 }
        )
      );

      setTimeout(() => {
        router.push("/dashboard");
      }, 1200);
    } catch {
      showNotice(
        makeNotice(
          "error",
          t("checkoutNetworkErrorTitle", "Network error"),
          t("checkoutNetworkErrorText", "Failed to submit. Please try again.")
        ),
        () => submitPaid()
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function claimFree() {
    if (submitting) return;

    clearNotice();
    setSubmitting(true);
    showNotice(
      makeNotice(
        "info",
        t("checkoutClaimingTitle", "Claiming…"),
        t("checkoutClaimingText", "Requesting your free Base Plan."),
        { autoHideMs: 2500 }
      )
    );

    try {
      const res = await fetch("/api/auth/orders/claim-free-base", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        showNotice(
          makeNotice(
            "error",
            t("checkoutClaimFailedTitle", "Claim failed"),
            data?.error || t("checkoutClaimFailedText", "Failed to claim free plan.")
          ),
          () => claimFree()
        );
        return;
      }

      showNotice(
        makeNotice(
          "success",
          t("checkoutBaseActivatedTitle", "Base activated"),
          t("checkoutBaseActivatedText", "Base Plan claimed successfully. Redirecting…"),
          { autoHideMs: 3500 }
        )
      );

      setTimeout(() => {
        router.push("/plans/base");
      }, 900);
    } catch {
      showNotice(
        makeNotice(
          "error",
          t("checkoutNetworkErrorTitle", "Network error"),
          t("checkoutFreeNetworkErrorText", "Failed to claim free plan. Please try again.")
        ),
        () => claimFree()
      );
    } finally {
      setSubmitting(false);
    }
  }

  const noticeClass =
    notice?.type === "success" ? "success" : notice?.type === "error" ? "warning" : "muted";
  const noticeIcon = notice?.type === "success" ? "✅" : notice?.type === "error" ? "⚠️" : "ℹ️";

  const planTitle = t(planMeta.titleKey, planMeta.titleFallback);
  const planCrumb = t(planMeta.crumbKey, planMeta.crumbFallback);
  const networkLabel = t(planMeta.networkLabelKey, planMeta.networkLabelFallback);

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      {/* Header */}
      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">{t("checkoutTag", "Checkout")}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {planCrumb.replace("USDT (TRC20)", networkLabel)}
          </span>
        </div>

        <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.2 }}>{planTitle}</h1>

        <p className="p" style={{ marginTop: 10, marginBottom: 0 }}>
          {t(planMeta.introKey, planMeta.introFallback)}
        </p>

        <div ref={noticeRef} />

        {notice?.text ? (
          <div className={noticeClass} style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ fontSize: 16, lineHeight: "20px" }}>{noticeIcon}</div>

              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{notice.title}</div>
                <div style={{ marginTop: 4 }}>{notice.text}</div>

                {notice.type === "error" && retryRef.current ? (
                  <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btnPrimary"
                      onClick={() => retryRef.current && retryRef.current()}
                      disabled={submitting}
                    >
                      {t("checkoutTryAgain", "Try again")}
                    </button>
                    <button type="button" className="btnGhost" onClick={clearNotice}>
                      {t("checkoutDismiss", "Dismiss")}
                    </button>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className="btnGhost"
                onClick={clearNotice}
                style={{ padding: "6px 10px", fontSize: 12 }}
              >
                {t("checkoutClose", "Close")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          {t("checkoutEta", "Estimated approval time:")}{" "}
          <b>
            {APPROVAL_WINDOW_HOURS.min}–{APPROVAL_WINDOW_HOURS.max} {t("checkoutHours", "hours")}
          </b>{" "}
          {t("checkoutAfterSubmission", "after submission.")}{" "}
        </div>

        {eligibleFree && (
          <div className="success" style={{ marginTop: 14 }}>
            {t("checkoutFirstTimeOffer", "🎁 First-time offer: You can claim Base Plan for free once.")}
            <div className="btnRow" style={{ marginTop: 10 }}>
              <button className="btnPrimary" type="button" onClick={claimFree} disabled={!canClaimFree}>
                {submitting ? t("checkoutProcessing", "Processing...") : t("checkoutGetBaseFree", "Get Base Plan FREE")}
              </button>
              <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
                {t("checkoutNoTxRequired", "No TxID required.")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Deposit wallet */}
      <div className="sectionBox" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>{t("checkoutDepositWalletTitle", "Deposit wallet")}</h3>

        <div className="walletBox">
          <div className="walletLabel">{networkLabel}</div>

          <div className="walletRow">
            <code className="walletAddr">
              {walletLoading ? t("checkoutLoading", "Loading...") : wallet || t("checkoutWalletNotSet", "Wallet not set")}
            </code>
            <button className="btnGhost" type="button" onClick={copyWallet} disabled={!wallet || walletLoading}>
              {copied ? t("checkoutCopiedBtn", "Copied ✓") : t("checkoutCopy", "Copy")}
            </button>
          </div>

          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            {t(planMeta.sendExactKey, planMeta.sendExactFallback)}
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="sectionBox" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>{t("checkoutSubmitTitle", "Submit transaction")}</h3>

        <div className="formGrid" style={{ marginTop: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              {t("checkoutAmountFixed", "Amount (fixed)")}
            </div>
            <input className="input" value={`${planMeta.fixedAmount}`} disabled />
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {t(planMeta.amountHintKey, planMeta.amountHintFallback)}
            </div>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              {t("checkoutTxidLabel", "TxID (Transaction Hash)")}
            </div>
            <input
              className="input"
              value={txid}
              onChange={(e) => setTxid(e.target.value)}
              placeholder={t("checkoutTxidPlaceholder", "Paste transaction hash here")}
              disabled={submitting}
            />

            {txid.trim().length > 0 ? (
              <div className={txidLooksValid ? "success" : "muted"} style={{ fontSize: 12, marginTop: 8, padding: txidLooksValid ? 10 : 0 }}>
                {txidLooksValid ? t("checkoutTxidValid", "✅ TxID looks valid.") : t("checkoutTxidTip", "Tip: TRON TxID is a 64-character hex hash (sometimes starts with 0x).")}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {t("checkoutTxidHelp", "After sending USDT, paste the Tx hash from your wallet / explorer.")}
              </div>
            )}
          </div>
        </div>

        {!isWalletReady ? (
          <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            {t("checkoutWalletNotReady", "Wallet is not ready yet. Please wait until it loads.")}
          </div>
        ) : null}

        <div className="btnRow" style={{ marginTop: 14 }}>
          <button className="btnGhost" onClick={() => router.push("/")} disabled={submitting}>
            {t("checkoutBack", "Back")}
          </button>
          <button
            className="btnPrimary"
            disabled={!canSubmitPaid}
            onClick={submitPaid}
            title={!isWalletReady ? t("checkoutWaitWallet", "Wait for wallet to load") : ""}
          >
            {submitting ? t("checkoutSubmittingBtn", "Submitting...") : t("checkoutSubmitForVerification", "Submit for verification")}
          </button>
        </div>

        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          {t("checkoutFooterEtaPrefix", "Estimated approval:")}{" "}
          <b>
            {APPROVAL_WINDOW_HOURS.min}–{APPROVAL_WINDOW_HOURS.max} {t("checkoutHours", "hours")}
          </b>
          {t("checkoutFooterEtaSuffix", ". Access is granted only after approval.")}
        </div>

        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          {t("checkoutFeePrefix", "Subscription fee:")} {planMeta.fee} USDT • {t("checkoutRiskManaged", "Risk-managed participation")} • {t("checkoutNoGuarantee", "No guaranteed returns")}
        </div>
      </div>

      <div style={{ height: 26 }} />
    </div>
  );
}
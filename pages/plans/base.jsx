import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/router";
import Nav from "../../components/Nav";
import { useLanguage } from "../../context/LanguageContext";
import translations from "../../translations";

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// ✅ سرمایه‌گذاری انجام شده؟ (حتی Pending)
function hasAnyInvestment(orders, email) {
  const list = Array.isArray(orders) ? orders : [];
  return list.some((o) => {
    const userEmail = String(o?.userEmail || "").toLowerCase();
    const type = String(o?.orderType || "").toLowerCase();
    const amount = Number(o?.amount || 0);

    // status/statusText برای رد/کنسل
    const status = String(o?.status || "").toLowerCase();
    const statusText = String(o?.statusText || "").toLowerCase();
    const s = `${status} ${statusText}`;

    if (!email) return false;
    if (userEmail !== String(email).toLowerCase()) return false;
    if (type !== "investment") return false;
    if (!(amount > 0)) return false;

    // اگر رد یا کنسل شده بود، سرمایه‌گذاری حساب نکن
    if (s.includes("rejected") || s.includes("reject") || s.includes("cancel")) return false;

    // Pending/Verification/Approved/... همه یعنی سرمایه‌گذاری شروع شده
    return true;
  });
}

export default function BasePlanPage() {
  const router = useRouter();
  const { lang, dir } = useLanguage();

  const t = useMemo(() => {
    const base = translations.en || {};
    const current = translations[lang] || base;
    return { ...base, ...current };
  }, [lang]);

  const bullets = Array.isArray(t.basePlanBullets) ? t.basePlanBullets : [];

  const [amount, setAmount] = useState("100");
  const [txid, setTxid] = useState("");
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  // ✅ FREE offer UI state
  const [freeEligible, setFreeEligible] = useState(false);
  const [checkingFree, setCheckingFree] = useState(true);
  const [claimingFree, setClaimingFree] = useState(false);
  const [freeMsg, setFreeMsg] = useState("");

  // ✅ Wallet (INVEST) — NEW
  const [depositWallet, setDepositWallet] = useState("");
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletErr, setWalletErr] = useState("");

  // ✅ Route guard: must be logged in (keep your existing behavior)
  useEffect(() => {
    const u = safeParse(localStorage.getItem("regorixa_current_user") || "null", null);
    if (!u) {
      router.replace("/login");
      return;
    }
    setCurrentUser(u);
  }, [router]);
    // ✅ Load INVEST wallet for deposits on this page
  useEffect(() => {
    let alive = true;

    async function loadWallet() {
      setWalletLoading(true);
      setWalletErr("");

      try {
        // ✅ IMPORTANT: this page is for investment deposit, not plan purchase
        const res = await fetch("/api/public/wallets?plan=invest", {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data?.ok) {
          throw new Error(String(data?.error || `Wallet API failed (${res.status})`));
        }

        const w = String(data?.wallet || "").trim();

        if (!alive) return;

        if (!w) {
          setDepositWallet("");
          setWalletErr(t?.checkout?.checkoutWalletNotSet || "Wallet not set");
        } else {
          setDepositWallet(w);
          setWalletErr("");
        }
      } catch (e) {
        if (!alive) return;
        setDepositWallet("");
        setWalletErr(t?.checkout?.checkoutWalletNotSet || "Wallet not set");
      } finally {
        if (alive) setWalletLoading(false);
      }
    }

    loadWallet();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // keep stable

  // ✅ Determine if user can see FREE: only if user has NO investments (even pending)
  useEffect(() => {
    let cancelled = false;

    async function checkEligibility() {
      if (!currentUser?.email) return;

      setCheckingFree(true);
      setFreeMsg("");

      try {
        // اگر شبکه مشکل داشت، برای امنیت بهتره FREE رو مخفی کنیم
        if (!cancelled) setFreeEligible(false);
      } finally {
        if (!cancelled) setCheckingFree(false);
      }
    }

    checkEligibility();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  async function copyWallet() {
    try {
      if (!depositWallet) return;
      await navigator.clipboard.writeText(depositWallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  // ✅ Claim FREE Base Plan (NO order creation)
  async function claimFreeBase() {
    if (!currentUser?.email) {
      alert(t?.plans?.alerts?.loginFirst || "Please login first.");
      router.push("/login");
      return;
    }

    setClaimingFree(true);
    setFreeMsg("");

    try {
      const res = await fetch("/api/auth/orders/claim-free-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        // اگر سرور گفت مجاز نیست، دیگه نشون نده
        setFreeEligible(false);
        setFreeMsg(data?.error || (t?.checkout?.checkoutClaimFailedText || "Activation failed"));
        return;
      }

      setFreeEligible(false);
      setFreeMsg(t?.checkout?.checkoutBaseActivatedText || "Base Plan activated successfully. Redirecting…");

      setTimeout(() => {
        router.push("/dashboard");
      }, 800);
    } catch {
      setFreeMsg(t?.checkout?.checkoutFreeNetworkErrorText || "Could not activate the free plan. Please try again.");
    } finally {
      setClaimingFree(false);
    }
  }
    async function submitRequest(e) {
    e.preventDefault();

    if (!currentUser?.email) {
      alert(t?.plans?.alerts?.loginFirst || "Please login first.");
      router.push("/login");
      return;
    }

    const a = Number(amount);
    if (!a || a < 100 || a % 100 !== 0) {
      alert(t?.plans?.alerts?.baseAmountInvalid || "Amount must be at least 100 and in multiples of 100 (USDT).");
      return;
    }

    const tx = String(txid || "").trim();
    if (!tx || tx.length < 20) {
      alert(t?.plans?.alerts?.txInvalid || "Please enter a valid transaction hash (TxID).");
      return;
    }

    try {
      const res = await fetch("/api/auth/orders/create-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ✅ include amount چون create-plan پشتیبانی می‌کنه
        body: JSON.stringify({ plan: "base", txid: tx, amount: a }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        alert(data?.error || `Submit failed (${res.status})`);
        return;
      }

      setSubmitted(true);
      setTxid("");

      // ✅ چون الان سرمایه‌گذاری ثبت شد، FREE هم باید حذف بشه
      setFreeEligible(false);
    } catch {
      alert("Network error. Please try again.");
    }
  }

  if (!currentUser) return null;

  const walletReady = !!depositWallet && !walletLoading;

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">Plan</span>
          <span className="muted" style={{ fontSize: 12 }}>
            Base Plan • USDT (TRC20) • No guaranteed returns
          </span>
        </div>

        <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.2 }}>
          {t.basePlanTitle || "Base Plan"}
        </h1>

        <p className="p" style={{ marginTop: 12, maxWidth: 900 }}>
          Review the agreement and deposit instructions below. After sending USDT, submit your TxID for verification.
        </p>

        {/* ✅ 🎁 FIRST-TIME FREE OFFER */}
        {!checkingFree && freeEligible ? (
          <div className="sectionBox" style={{ marginTop: 14 }}>
            <div className="muted" style={{ fontSize: 13 }}>
              {t?.checkout?.checkoutFirstTimeOffer ||
                t?.checkout?.freeOffer ||
                "First-time offer: You can access Base Plan for free before your first investment."}
            </div>

            <button
              type="button"
              className="btnPrimary"
              style={{ marginTop: 10 }}
              onClick={claimFreeBase}
              disabled={claimingFree}
            >
              {claimingFree
                ? (t?.checkout?.checkoutClaimingText || "Activating…")
                : (t?.checkout?.checkoutGetBaseFree || t?.checkout?.freeBtn || "Get Base Plan FREE")}
            </button>

            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {t?.checkout?.checkoutNoTxRequired || t?.checkout?.noTxRequired || "No TxID required."}
            </div>

            {freeMsg ? (
              <div className="success" style={{ marginTop: 10 }}>
                {freeMsg}
              </div>
            ) : null}
          </div>
        ) : null}

        {checkingFree ? (
          <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Checking eligibility…
          </div>
        ) : null}

        {/* Agreement */}
        <div className="sectionBox" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Agreement (Summary)</h3>
          <ul className="planList">
            <li>Participation involves risk. Returns are variable and not guaranteed.</li>
            <li>Principal may be locked based on plan rules.</li>
            <li>Withdrawals follow the published window and processing policy.</li>
            <li>By continuing, you confirm you read and accept Legal & Risk disclosures.</li>
          </ul>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a className="btnGhost" href="/legal">Read Legal</a>
            <a className="btnGhost" href="/transparency">Read Transparency</a>
          </div>
        </div>

        {/* Plan Details */}
        <div className="sectionBox" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Plan details</h3>
          <ul className="planList">
            {bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>

        {/* ✅ Deposit wallet (INVEST WALLET) */}
        <div className="sectionBox" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Deposit wallet</h3>

          <div className="walletBox">
            <div className="walletLabel">USDT (TRC20)</div>
            <div className="walletRow">
              <code className="walletAddr">
                {walletLoading ? (t?.checkout?.checkoutLoading || "Loading...") : (depositWallet || (t?.checkout?.checkoutWalletNotSet || "Wallet not set"))}
              </code>
              <button className="btnGhost" type="button" onClick={copyWallet} disabled={!walletReady}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>

            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Send only USDT on TRC20 to this address. Sending other assets/networks may result in loss of funds.
            </div>

            {!walletReady && !walletLoading && (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {walletErr || (t?.checkout?.checkoutWalletNotReady || "Wallet is not ready yet.")}
              </div>
            )}
          </div>
        </div>

        {/* Submit transaction */}
        <div className="sectionBox" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Submit transaction</h3>

          <form onSubmit={submitRequest} className="formGrid">
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Amount (USDT)</div>
              <input
                className="input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100"
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Minimum for Base Plan is 100 USDT.
              </div>
            </div>

            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>TxID (Transaction Hash)</div>
              <input
                className="input"
                value={txid}
                onChange={(e) => setTxid(e.target.value)}
                placeholder="Paste transaction hash here"
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                After sending USDT, paste the Tx hash from your wallet / explorer.
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btnPrimary" type="submit">Submit for verification</button>
              <span className="muted" style={{ fontSize: 12 }}>Verification can be manual at first.</span>
            </div>
          </form>

          {submitted && (
            <div className="success" style={{ marginTop: 12 }}>
              ✅ Submitted! We received your request. Please wait for admin approval.
            </div>
          )}
        </div>

        <div style={{ height: 10 }} />
      </div>

      <div style={{ height: 26 }} />
    </div>
  );
}
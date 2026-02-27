import { useMemo, useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import Nav from "../../components/Nav";
import { useLanguage } from "../../context/LanguageContext";
import translations from "../../translations";

function normWallet(w) {
  const s = String(w || "").trim();
  return s || "";
}

function isTxidValid(tx) {
  const v = String(tx || "").trim();
  return v.length >= 20;
}

async function readJsonOrText(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return await res.json().catch(() => ({}));
  }
  return { error: await res.text().catch(() => "") };
}

export default function VipPlanPage() {
  const router = useRouter();
  const { lang, dir } = useLanguage();

  const t = useMemo(() => {
    const base = translations.en || {};
    const current = translations[lang] || base;
    return { ...base, ...current };
  }, [lang]);

  const bullets = Array.isArray(t?.plans?.vipBullets)
    ? t.plans.vipBullets
    : Array.isArray(t?.vipPlanBullets)
    ? t.vipPlanBullets
    : Array.isArray(t?.advancedPlanBullets)
    ? t.advancedPlanBullets
    : [];

  // ✅ VIP amount (مثل Base: قابل تغییر)
  // این 3 تا رو تنظیم کن مطابق قوانین VIP خودت
  const VIP_MIN = 1000;
  const VIP_STEP = 100; // مثلا مضرب 100
  const VIP_DEFAULT = 1000;

  const [amount, setAmount] = useState(String(VIP_DEFAULT)); // ✅ قابل تغییر
  const [txid, setTxid] = useState("");
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [currentUser, setCurrentUser] = useState(null);

  // Wallet
  const [wallet, setWallet] = useState("");
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletErr, setWalletErr] = useState("");

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(""); // ✅ show error on page
  const aliveRef = useRef(true);

  // Route guard
  useEffect(() => {
    aliveRef.current = true;
    let alive = true;

    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data?.ok || !data?.user?.email) {
          router.replace("/login");
          return;
        }

        if (!alive) return;
        setCurrentUser(data.user);
      } catch {
        router.replace("/login");
      }
    })();

    return () => {
      alive = false;
      aliveRef.current = false;
    };
  }, [router]);
    // ✅ Load INVEST wallet (same wallet as /plans/base)
  useEffect(() => {
    let alive = true;

    async function loadWallet() {
      setWalletLoading(true);
      setWalletErr("");

      try {
        // ✅ IMPORTANT: investment wallet
        const res = await fetch("/api/public/wallets?plan=invest", {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        const data = await readJsonOrText(res);

        if (!res.ok || !data?.ok) {
          throw new Error(String(data?.error || `Wallet API failed (${res.status})`));
        }

        const normalized = normWallet(data?.wallet || "");
        if (alive && normalized) {
          setWallet(normalized);
          setWalletLoading(false);
          return;
        }

        if (alive) {
          setWallet("");
          setWalletErr(t?.checkout?.checkoutWalletNotSet || "Wallet not set");
          setWalletLoading(false);
          return;
        }
      } catch (e) {
        console.error("VIP wallet load error:", e);
      }

      // fallback to env (keep behavior as fallback)
      const envWallet = normWallet(process.env.NEXT_PUBLIC_VIP_WALLET);
      if (alive && envWallet) {
        setWallet(envWallet);
        setWalletLoading(false);
        return;
      }

      if (alive) {
        setWallet("");
        setWalletErr(t?.checkout?.checkoutWalletNotSet || "Wallet not set");
        setWalletLoading(false);
      }
    }

    loadWallet();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // keep as is

  const walletReady = !!wallet && !walletLoading;

  async function copyWallet() {
    if (!walletReady) return;
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  const canSubmit =
    !!currentUser?.email &&
    walletReady &&
    !submitting &&
    isTxidValid(txid) &&
    (() => {
      const a = Number(String(amount || "").trim());
      return Number.isFinite(a) && a >= VIP_MIN && a % VIP_STEP === 0;
    })();

  async function submitRequest(e) {
    e.preventDefault();
    if (submitting) return;

    setSubmitErr("");
    setSubmitted(false);

    if (!currentUser?.email) {
      alert(t?.plans?.alerts?.loginFirst || "Please login first.");
      router.push("/login");
      return;
    }

    if (!walletReady) {
      alert(
        t?.checkout?.checkoutWalletNotReady ||
          "Wallet is not ready yet. Please wait until it finishes loading."
      );
      return;
    }

    const a = Number(String(amount || "").trim());
    if (!Number.isFinite(a) || a < VIP_MIN || a % VIP_STEP !== 0) {
      setSubmitErr(
        t?.plans?.alerts?.vipAmountInvalid ||
          `Amount must be at least ${VIP_MIN} and in multiples of ${VIP_STEP} (USDT).`
      );
      return;
    }

    const tx = String(txid || "").trim();
    if (!isTxidValid(tx)) {
      setSubmitErr(t?.plans?.alerts?.txInvalid || "Please enter a valid transaction hash (TxID).");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/orders/create-plan", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ plan: "vip", txid: tx, amount: a }),
      });

      const data = await readJsonOrText(res);

      if (!res.ok || !data?.ok) {
        console.error("VIP submit failed:", { status: res.status, data });

        if (res.status === 401) {
          alert("Session expired. Please login again.");
          router.push("/login");
          return;
        }

        // ✅ بهتر برای txid تکراری
        if (res.status === 409) {
          setSubmitErr(
            t?.plans?.alerts?.txDuplicate ||
              "This TxID was already submitted. Please check your TxID or contact support."
          );
          return;
        }

        setSubmitErr(String(data?.error || `Submit failed (${res.status})`));
        return;
      }

      if (!aliveRef.current) return;

      setSubmitted(true);
      setTxid("");
      alert(data?.message || "Submitted ✅");
    } catch (err) {
      console.error("VIP submit exception:", err);
      setSubmitErr(t?.checkout?.checkoutNetworkErrorText || "Network error. Please try again.");
    } finally {
      if (aliveRef.current) setSubmitting(false);
    }
  }

  if (!currentUser) return null;
    const pageTag = t?.plans?.tag || "Plan";
  const vipTitle = t?.plans?.vipTitle || t?.checkout?.checkoutVipTitle || "VIP Plan";

  const crumb =
    t?.checkout?.checkoutCrumbVip ||
    "VIP Plan • Pay with USDT (TRC20) • Submit TxID";

  const reviewNotice =
    t?.plans?.reviewNotice ||
    "Review the agreement and deposit instructions below. After sending USDT, submit your TxID for verification.";

  const agreementTitle = t?.plans?.agreementTitle || "Agreement (Summary)";
  const agreement1 =
    t?.plans?.agreement1 ||
    "Participation involves risk. Returns are variable and not guaranteed.";
  const agreement2 =
    t?.plans?.agreement2Base ||
    t?.plans?.agreement2 ||
    "Principal may be locked based on plan rules.";
  const agreement3 =
    t?.plans?.agreement3 ||
    "Withdrawals follow the published window and processing policy.";
  const agreement4 =
    t?.plans?.agreement4 ||
    "By continuing, you confirm you read and accept Legal & Risk disclosures.";

  const readLegal = t?.plans?.readLegal || t?.readLegal || "Read Legal";
  const readTransparency =
    t?.plans?.readTransparency || t?.heroTransparency || "Read Transparency";

  const detailsTitle = t?.plans?.detailsTitle || "Plan details";

  const depositWalletTitle =
    t?.plans?.depositWalletTitle ||
    t?.checkout?.checkoutDepositWalletTitle ||
    "Deposit wallet";

  const usdtTrc20 = t?.checkout?.checkoutUsdtTrc20 || "USDT (TRC20)";

  const loadingText = t?.checkout?.checkoutLoading || "Loading...";
  const walletNotSetText = t?.checkout?.checkoutWalletNotSet || "Wallet not set";
  const copyText = t?.checkout?.checkoutCopy || t?.checkout?.copy || "Copy";
  const copiedText = t?.checkout?.checkoutCopiedBtn || t?.checkout?.copied || "Copied ✓";

  const sendOnly =
    t?.plans?.sendOnlyTrc20 ||
    t?.checkout?.checkoutSendExactVip ||
    "Send only USDT on TRC20 to this address. Sending other assets/networks may result in loss of funds.";

  const submitTitle =
    t?.plans?.submitTxTitle ||
    t?.checkout?.checkoutSubmitTitle ||
    "Submit transaction";

  const amountLabel = t?.plans?.amountLabel || "Amount (USDT)";
  const txidLabel = t?.plans?.txidLabel || "TxID (Transaction Hash)";
  const txPlaceholder =
    t?.plans?.txidPlaceholder ||
    t?.checkout?.checkoutTxidPlaceholder ||
    "Paste transaction hash here";
  const txHelp =
    t?.plans?.txidHelp ||
    t?.checkout?.checkoutTxidHelp ||
    "After sending USDT, paste the transaction hash from your wallet / explorer.";

  const submitBtn =
    t?.checkout?.checkoutSubmitForVerification ||
    t?.plans?.submitForVerification ||
    "Submit for verification";
  const submittingBtn = t?.checkout?.checkoutSubmittingBtn || "Submitting...";

  const verifyNote =
    walletReady
      ? t?.plans?.verificationNote || "Verification can be manual at first."
      : t?.checkout?.checkoutWalletNotReady ||
        "Wallet is not ready yet. Please wait until it finishes loading.";

  const submittedMsg =
    t?.plans?.submittedBase ||
    "✅ Submitted! We received your request. Please wait for admin approval.";

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">{pageTag}</span>
          <span className="muted" style={{ fontSize: 12 }}>{crumb}</span>
        </div>

        <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.2 }}>{vipTitle}</h1>
        <p className="p" style={{ marginTop: 12, maxWidth: 900 }}>{reviewNotice}</p>

        {/* Agreement */}
        <div className="sectionBox" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>{agreementTitle}</h3>
          <ul className="planList">
            <li>{agreement1}</li>
            <li>{agreement2}</li>
            <li>{agreement3}</li>
            <li>{agreement4}</li>
          </ul>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a className="btnGhost" href="/legal">{readLegal}</a>
            <a className="btnGhost" href="/transparency">{readTransparency}</a>
          </div>
        </div>

        {/* Plan Details */}
        <div className="sectionBox" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>{detailsTitle}</h3>
          <ul className="planList">
            {bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>

        {/* Deposit wallet */}
        <div className="sectionBox" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>{depositWalletTitle}</h3>

          <div className="walletBox">
            <div className="walletLabel">{usdtTrc20}</div>

            <div className="walletRow">
              <code className="walletAddr">
                {walletLoading ? loadingText : wallet || walletNotSetText}
              </code>

              <button
                className="btnGhost"
                type="button"
                onClick={copyWallet}
                disabled={!walletReady}
                title={!walletReady ? walletNotSetText : copyText}
                style={{
                  opacity: walletReady ? 1 : 0.6,
                  cursor: walletReady ? "pointer" : "not-allowed",
                }}
              >
                {copied ? copiedText : copyText}
              </button>
            </div>

            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>{sendOnly}</div>

            {!walletReady && (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {walletLoading
                  ? (t?.checkout?.checkoutProcessing || "Processing...")
                  : walletErr || (t?.checkout?.checkoutWalletNotReady || "Wallet is not ready yet.")}
              </div>
            )}
          </div>
        </div>

        {/* Submit */}
        <div className="sectionBox" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>{submitTitle}</h3>

          <form onSubmit={submitRequest} className="formGrid">
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{amountLabel}</div>
              <input
                className="input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={String(VIP_DEFAULT)}
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {t?.plans?.vipAmountHint ||
                  `Minimum for VIP Plan is ${VIP_MIN} USDT (multiples of ${VIP_STEP}).`}
              </div>
            </div>

            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{txidLabel}</div>
              <input
                className="input"
                value={txid}
                onChange={(e) => setTxid(e.target.value)}
                placeholder={txPlaceholder}
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{txHelp}</div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button
                className="btnPrimary"
                type="submit"
                disabled={!canSubmit}
                style={{
                  opacity: canSubmit ? 1 : 0.6,
                  cursor: canSubmit ? "pointer" : "not-allowed",
                }}
              >
                {submitting ? submittingBtn : submitBtn}
              </button>

              <span className="muted" style={{ fontSize: 12 }}>{verifyNote}</span>
            </div>
          </form>

          {submitErr && (
            <div className="error" style={{ marginTop: 12 }}>
              {submitErr}
            </div>
          )}

          {submitted && !submitErr && (
            <div className="success" style={{ marginTop: 12 }}>
              {submittedMsg}
            </div>
          )}
        </div>

        <div style={{ height: 10 }} />
      </div>

      <div style={{ height: 26 }} />
    </div>
  );
}
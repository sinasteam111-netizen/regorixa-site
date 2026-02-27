import { useMemo, useEffect, useState, useRef } from "react";
import { useRouter } from "next/router";
import Nav from "../../components/Nav";
import { useLanguage } from "../../context/LanguageContext";
import translations from "../../translations";

// ❌ const ADV_WALLET = "PUT_ADVANCED_PLAN_TRC20_WALLET_HERE";

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

export default function AdvancedPlanPage() {
  const router = useRouter();
  const { lang, dir } = useLanguage();

  const t = useMemo(() => {
    const base = translations.en || {};
    const current = translations[lang] || base;
    return { ...base, ...current };
  }, [lang]);

  const bullets = Array.isArray(t.advancedPlanBullets) ? t.advancedPlanBullets : [];

  const [copied, setCopied] = useState(false);

  // ✅ user/allowed now from server (مثل VIP)
  const [currentUser, setCurrentUser] = useState(null);
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);

  // ✅ فرم Tx
  const [amount, setAmount] = useState("300");
  const [txid, setTxid] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // ✅ Wallet (dynamic)
  const [wallet, setWallet] = useState("");
  const [walletLoading, setWalletLoading] = useState(false);

  const didInit = useRef(false);

  // ✅ گارد جدید: لاگین + Approved plan=advanced از روی orders/my
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    let alive = true;

    (async () => {
      try {
        setChecking(true);

        // 1) me
        const meRes = await fetch("/api/auth/me", { credentials: "include" });
        const meData = await meRes.json().catch(() => ({}));

        if (!meRes.ok || !meData?.ok || !meData?.user?.email) {
          router.replace("/login");
          return;
        }

        if (!alive) return;
        setCurrentUser(meData.user);

        // 2) orders/my
        const ordRes = await fetch("/api/auth/orders/my", { credentials: "include" });
        const ordData = await ordRes.json().catch(() => ({}));

        const list = Array.isArray(ordData?.orders) ? ordData.orders : [];

        // ✅ پلن خریداری شده (orderType=plan) باید Approved باشه و plan=advanced
        const hasApprovedAdvancedPlan = list.some((o) => {
          const isPlan = norm(o?.orderType) === "plan";
          const isAdvanced = norm(o?.plan) === "advanced" || norm(o?.plan) === "adv";
          const st = norm(o?.status || o?.statusText);
          const isApproved = st === "approved";
          return isPlan && isAdvanced && isApproved;
        });

        if (!hasApprovedAdvancedPlan) {
          router.replace("/checkout?plan=advanced");
          return;
        }

        if (!alive) return;
        setAllowed(true);
      } catch (e) {
        // اگر خطا شد، امن‌ترین رفتار: برگرده checkout
        router.replace("/checkout?plan=advanced");
      } finally {
        if (alive) setChecking(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [router]);
    // ✅ fetch INVEST wallet from public endpoint (same source as /plans/base)
  useEffect(() => {
    let mounted = true;

    (async () => {
      setWalletLoading(true);
      try {
        // ✅ IMPORTANT: investment wallet
        const res = await fetch("/api/public/wallets?plan=invest", {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

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
  }, []);

  async function copyWallet() {
    try {
      if (!wallet) return;
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  async function submitRequest(e) {
    e.preventDefault();

    if (!currentUser?.email) {
      alert("Please login first.");
      router.push("/login");
      return;
    }

    const a = Number(String(amount || "").trim());
    const ADV_MIN = 300;

    if (!Number.isFinite(a) || a < ADV_MIN) {
      alert(`Minimum for Advanced Plan is ${ADV_MIN} USDT.`);
      return;
    }

    const tx = String(txid || "").trim();
    if (!tx || tx.length < 20) {
      alert("Please enter a valid transaction hash (TxID).");
      return;
    }

    try {
      const res = await fetch("/api/auth/orders/create-plan", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "advanced", txid: tx, amount: a }), // ✅ amount ارسال شد
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        alert(data?.error || `Submit failed (${res.status})`);
        return;
      }

      setSubmitted(true);
      setTxid("");
    } catch {
      alert("Network error. Please try again.");
    }
  }

  // ✅ تا وقتی چک می‌کنه، هیچی نشون نده (مثل VIP رفتار پایدار)
  if (checking) return null;
  if (!currentUser || !allowed) return null;
    return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">Plan</span>
          <span className="muted" style={{ fontSize: 12 }}>
            Advanced Plan • USDT (TRC20) • No guaranteed returns
          </span>
        </div>

        <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.2 }}>
          {t.advancedPlanTitle || "Advanced Plan"}
        </h1>

        <p className="p" style={{ marginTop: 12, maxWidth: 900 }}>
          Your plan is approved. Review the agreement and deposit instructions below.
        </p>

        {/* Agreement */}
        <div className="sectionBox" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Agreement (Summary)</h3>
          <ul className="planList">
            <li>Participation involves risk. Returns are variable and not guaranteed.</li>
            <li>Principal may be locked based on plan rules and minimums.</li>
            <li>Withdrawals follow the published window and processing policy.</li>
            <li>By continuing, you confirm you read and accept Legal & Risk disclosures.</li>
          </ul>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a className="btnGhost" href="/legal">Read Legal</a>
            <a className="btnGhost" href="/transparency">Read Transparency</a>
          </div>
        </div>

        {/* Plan details */}
        <div className="sectionBox" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Plan details</h3>
          <ul className="planList">
            {bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>

        {/* Deposit wallet */}
        <div className="sectionBox" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Deposit wallet</h3>

          <div className="walletBox">
            <div className="walletLabel">USDT (TRC20)</div>
            <div className="walletRow">
              <code className="walletAddr">
                {walletLoading ? "Loading..." : wallet || "Wallet not set"}
              </code>

              <button className="btnGhost" type="button" onClick={copyWallet} disabled={!wallet || walletLoading}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Send only USDT on TRC20 to this address. Sending other assets/networks may result in loss of funds.
            </div>
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
                placeholder="300"
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Minimum for Advanced Plan is 300 USDT.
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
              ✅ Submitted! We received your transaction. Please wait for admin verification.
            </div>
          )}
        </div>

        <div style={{ height: 10 }} />
      </div>

      <div style={{ height: 26 }} />
    </div>
  );
}
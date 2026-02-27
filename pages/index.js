
import Link from "next/link";
import { useEffect, useState } from "react";
import Nav from "../components/Nav";
import { useLang } from "../context/LanguageContext";

/** Generates a premium candle set (numbers only; px added in JSX). */
function generateCandles(count = 12) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const h = 110 + Math.floor(Math.random() * 120); // 110..229
    const body = 42 + Math.floor(Math.random() * 70); // 42..111
    const top = 10 + Math.floor(Math.random() * Math.max(12, h - body - 12));
    const up = Math.random() > 0.38;

    out.push({
      h,
      body,
      top,
      dir: up ? "up" : "down",
      key: `${i}-${h}-${body}-${top}-${up ? "u" : "d"}`,
    });
  }
  return out;
}

export default function Home() {
  const { lang, dir, t, tv } = useLang();

  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);

  // Candles generated on client once, then re-generated periodically for "alive" feel
  const [candles, setCandles] = useState([]);

  useEffect(() => {
    setCandles(generateCandles(12));

    const id = setInterval(() => {
      setCandles(generateCandles(12));
    }, 22000);

    return () => clearInterval(id);
  }, []);

  // Arrays/Objects must come from tv()
  const rules = tv("rules", []);
  const whyCards = tv("whyCards", []);
  const basePlanBullets = tv("basePlanBullets", []);
  const advancedPlanBullets = tv("advancedPlanBullets", []);
  // ✅ NEW: VIP bullets (اگر تو translations نباشه، fallback ثابت میذاریم)
  const vipPlanBullets = tv("vipPlanBullets", null);

  function onJoinWaitlist(e) {
    e.preventDefault();
    const v = (email || "").trim();
    if (!v || !v.includes("@")) return;

    try {
      const key = "regorixa_waitlist";
      const prev = JSON.parse(localStorage.getItem(key) || "[]");
      const next = Array.isArray(prev) ? prev : [];
      if (!next.includes(v)) next.push(v);
      localStorage.setItem(key, JSON.stringify(next));
      setSaved(true);
      setEmail("");
    } catch {
      setSaved(true);
      setEmail("");
    }
  }

  // ✅ NEW: bullets fallback برای VIP
  const vipBullets =
    Array.isArray(vipPlanBullets) && vipPlanBullets.length
      ? vipPlanBullets
      : [
          `Monthly Profit: 9%`,
          `Subscription Fee: 1000 USDT`,
          `Minimum investment: 1000 USDT`,
          `Priority processing & premium support`,
        ];

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      {/* HERO */}
      <div className="heroBackWrap">
        <section className="glass section heroPro">
          <div className="heroGrid">
            {/* Left */}
            <div className="heroLeft">
              <div className="tagRow" style={{ marginBottom: 14 }}>
                <span className="tag">{t("heroTag", "Subscription-Based Platform")}</span>
                <span className="muted heroNote">
                  {t("heroNote", "Risk-managed participation • No guaranteed returns")}
                </span>
              </div>

              <h1 className="heroTitle" style={{ fontSize: "clamp(34px, 4vw, 56px)" }}>
                {t("heroHeadline", "Structured Investment.")}{" "}
                <span className="heroTitleLight">{t("heroHeadline2", "Disciplined Growth.")}</span>
              </h1>

              <p className="heroSub">
                {t(
                  "heroSubheadline",
                  "REGORIXA is a subscription-based investment platform focused on consistency, capital protection, and transparent participation rules."
                )}
              </p>

              {/* Crypto + Forex line */}
              <div className="heroMarkets">
                <span className="heroMarketsDot" />
                <span>
                  {t("heroMarketsPrefix", "We operate across")} <strong>Crypto</strong>{" "}
                  {t("heroMarketsAnd", "and")} <strong>Forex</strong> {t("heroMarketsSuffix", "markets.")}
                </span>
              </div>

              <div className="btnRow heroCtas">
                <a href="#plans" className="btnPrimary">
                  {t("heroExplorePlans", "Explore Investment Plans")} →
                </a>

                <a href="/faq" className="btnGhost">
                  {t("heroFaq", "FAQ")}
                </a>

                <a href="/legal" className="btnGhost">
                  {t("heroLegal", "Legal")}
                </a>

                <a href="/transparency" className="btnGhost">
                  {t("heroTransparency", "Transparency")}
                </a>
              </div>

              <div className="heroPoints">
                <span>• {t("heroPoint1", "Clear plan requirements")}</span>
                <span>• {t("heroPoint2", "Structured lock & withdrawal rules")}</span>
                <span>• {t("heroPoint3", "Risk disclosure available in Legal")}</span>
              </div>

              <div className="heroMiniCta">
                <button
                  className="btnPrimary"
                  onClick={() => {
                    setSaved(false);
                    setWaitlistOpen(true);
                  }}
                  type="button"
                >
                  {t("heroJoinWaitlist", "Join Waitlist")}
                </button>
                <span className="muted heroMiniHint">{t("heroMiniHint", "Early access updates • No spam")}</span>
              </div>

              <div className="heroKpis">
                <div className="heroKpi">
                  <div className="heroKpiTop">{t("kpiMin", "Min 100 USDT")}</div>
                  <div className="heroKpiBottom">{t("kpiEntry", "Entry")}</div>
                </div>
                <div className="heroKpi">
                  <div className="heroKpiTop">{t("kpiLockTop", "2 Months")}</div>
                  <div className="heroKpiBottom">{t("kpiLockBottom", "Lock")}</div>
                </div>
                <div className="heroKpi">
                  <div className="heroKpiTop">{t("kpiProcessingTop", "24h")}</div>
                  <div className="heroKpiBottom">{t("kpiProcessingBottom", "Processing")}</div>
                </div>
              </div>
            </div>

            {/* Right Visual (Real OHLC candles) */}
            <div className="heroRight" aria-hidden="true">
              <div className="heroGlow" />
              <div className="heroShine" />

              <div className="ohlcMarquee">
                <div className="ohlcTrack">
                  {candles.map((c, idx) => (
                    <div
                      key={`a-${c.key}`}
                      className={`ohlcCandle ${c.dir}`}
                      style={{
                        "--h": `${c.h}px`,
                        "--body": `${c.body}px`,
                        "--top": `${c.top}px`,
                        animationDelay: `${idx * 0.35}s`,
                      }}
                    />
                  ))}
                </div>

                <div className="ohlcTrack" aria-hidden="true">
                  {candles.map((c, idx) => (
                    <div
                      key={`b-${c.key}`}
                      className={`ohlcCandle ${c.dir}`}
                      style={{
                        "--h": `${c.h}px`,
                        "--body": `${c.body}px`,
                        "--top": `${c.top}px`,
                        animationDelay: `${idx * 0.35}s`,
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="heroWave" />
            </div>
          </div>
        </section>
      </div>

      {/* Header */}
      <div style={{ marginTop: 22 }}>
        <h2 style={{ marginBottom: 6 }}>{t("title")}</h2>
        <p style={{ marginTop: 0, opacity: 0.85 }}>{t("subtitle")}</p>
      </div>

      {/* How it works */}
      <div className="sectionBox" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0, marginBottom: 10 }}>{t("howItWorksTitle", "How it works")}</h3>

        <div className="howGrid">
          <div className="howCard">
            <div className="howNum">1</div>
            <div className="howTitle">{t("howStep1Title", "Choose a plan")}</div>
            <div className="howText">
              {t("howStep1Text", "Pick Base or Advanced based on your subscription level and minimum investment.")}
            </div>
          </div>

          <div className="howCard">
            <div className="howNum">2</div>
            <div className="howTitle">{t("howStep2Title", "Follow the rules")}</div>
            <div className="howText">
              {t("howStep2Text", "Capital is locked for the defined period. Contributions follow clear increments.")}
            </div>
          </div>

          <div className="howCard">
            <div className="howNum">3</div>
            <div className="howTitle">{t("howStep3Title", "Profit cycle & withdrawals")}</div>
            <div className="howText">
              {t("howStep3Text", "After the cycle completes, withdrawal requests open during the allowed window.")}
            </div>
          </div>
        </div>
      </div>

      {/* Investment Model */}
      <div style={{ marginTop: 18 }}>
        <h3 style={{ marginBottom: 8 }}>{t("investmentModelTitle")}</h3>
        <p style={{ opacity: 0.9, lineHeight: 1.7 }}>{t("investmentModelText")}</p>

        <ul style={{ opacity: 0.92, lineHeight: 1.8 }}>
          {rules.map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ul>
      </div>

      {/* WHY */}
      <div
        style={{
          marginTop: 22,
          padding: 18,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.03)",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>{t("whyTitle")}</h3>

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          {whyCards.map((card, idx) => (
            <div
              key={idx}
              className="liftCard"
              style={{
                padding: 14,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6 }}>{card?.title}</div>
              <div style={{ opacity: 0.9, lineHeight: 1.65 }}>{card?.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* PLANS */}
      <div id="plans" className="sectionBox">
        <div className="sectionHeaderRow">
          <h3 style={{ margin: 0 }}>{t("investmentPlansTitle")}</h3>
          <Link href="/transparency" className="miniLink">
            {t("viewTransparency", "View full transparency")} →
          </Link>
        </div>

        <div className="pricingGrid">
          <Link href="/checkout?plan=base" className="planLink">
            <div className="planCard">
              <div className="planHeader">
                <h4>{t("basePlanTitle")}</h4>
                <span className="badge">{t("badgeStarter", "Starter")}</span>
              </div>

              <ul className="planList">
                {basePlanBullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>

              <div className="planFooter">
                <span className="planMeta">{t("clickToContinue", "Click to continue")}</span>
                <span className="planCta">{t("buyCta", "Buy")} →</span>
              </div>
            </div>
          </Link>

          <Link href="/checkout?plan=advanced" className="planLink">
            <div className="planCard planStrong">
              <div className="planHeader">
                <h4>{t("advancedPlanTitle")}</h4>
                <span className="badge">{t("badgeMostPopular", "Most Popular")}</span>
              </div>

              <ul className="planList">
                {advancedPlanBullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>

              <div className="planFooter">
                <span className="planMeta">{t("clickToContinue", "Click to continue")}</span>
                <span className="planCta">{t("buyCta", "Buy")} →</span>
              </div>
            </div>
          </Link>

          {/* ✅ NEW: VIP PLAN */}
          <Link href="/checkout?plan=vip" className="planLink">
            <div className="planCard planStrong">
              <div className="planHeader">
                <h4>{t("vipPlanTitle", "VIP Plan")}</h4>
                <span className="badge">{t("badgeVip", "VIP")}</span>
              </div>

              <ul className="planList">
                {vipBullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>

              <div className="planFooter">
                <span className="planMeta">{t("clickToContinue", "Click to continue")}</span>
                <span className="planCta">{t("buyCta", "Buy")} →</span>
              </div>
            </div>
          </Link>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btnPrimary" type="button">
            {t("startButton")}
          </button>
          <Link className="btnGhost" href="/legal">
            {t("readLegal", "Read Legal")}
          </Link>
        </div>
      </div>

      {/* DISCLAIMER */}
      <div
        style={{
          marginTop: 22,
          padding: 16,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 6 }}>{t("disclaimerTitle", "Important Notice")}</div>

        <div style={{ opacity: 0.9, lineHeight: 1.7 }}>
          {t(
            "disclaimerText",
            "All participation involves market risk. Returns are variable and not guaranteed. Please review the Legal section for full risk disclosures."
          )}
        </div>
      </div>

      <div style={{ height: 26 }} />

      {/* WAITLIST MODAL */}
      {waitlistOpen && (
        <div className="modalOverlay" onClick={() => setWaitlistOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalTop">
              <div>
                <div className="modalTitle">{t("waitlistTitle", "Join the Waitlist")}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {t("waitlistSubtitle", "Get early-access updates. No spam.")}
                </div>
              </div>

              <button className="iconBtn" onClick={() => setWaitlistOpen(false)} aria-label="Close" type="button">
                ✕
              </button>
            </div>

            <form onSubmit={onJoinWaitlist} className="modalForm">
              <input
                className="input"
                placeholder={t("waitlistEmailPlaceholder", "you@example.com")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button className="btnPrimary" type="submit">
                {t("waitlistSubmit", "Submit")}
              </button>
            </form>

            {saved && (
              <div className="success">
                {t("waitlistSaved", "✅ Saved! We’ll contact you when early access is available.")}
              </div>
            )}

            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              {t("waitlistDisclaimerPrefix", "By submitting you confirm you’ve read the disclosures in")}{" "}
              <a href="/legal">{t("waitlistLegalLink", "Legal")}</a>.
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

import Head from "next/head";
import Nav from "../components/Nav";
import { useLanguage } from "../context/LanguageContext";

export default function About() {
  const { dir, t } = useLanguage();

  const pageTitle = t(
    "about.seoTitle",
    "About REGORIXA | 10+ Years Trading Experience & Risk-Managed Investing"
  );

  const pageDesc = t(
    "about.seoDesc",
    "Learn about REGORIXA, a subscription-based investment platform backed by 10+ years of market experience, focused on disciplined execution, risk management, and transparent participation rules."
  );

  const canonical = "https://regorixa.com/about"; // ✅ اگر دامنه‌ات چیز دیگه‌ست، همین خط رو عوض کن

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDesc} />

        {/* Canonical */}
        <link rel="canonical" href={canonical} />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDesc} />
        <meta property="og:url" content={canonical} />
        <meta property="og:site_name" content="REGORIXA" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDesc} />
      </Head>

      <Nav />

      {/* Header */}
      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">{t("about.tag", "About")}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {t("about.tagline", "Who we are • How we operate • Our principles")}
          </span>
        </div>

        <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.2 }}>
          {t("about.title", "About REGORIXA")}
        </h1>

        <p className="p" style={{ marginTop: 10, marginBottom: 0, opacity: 0.9, lineHeight: 1.8 }}>
          {t(
            "about.intro",
            "REGORIXA is a subscription-based investment platform built around disciplined execution, risk management, and transparent participation rules."
          )}
        </p>
      </div>

      {/* Story + Team */}
      <div className="twoCol" style={{ marginTop: 18 }}>
        {/* Our Story */}
        <div className="sectionBox" style={{ marginTop: 0 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>
            {t("about.storyTitle", "Our Story — 10+ Years of Market Experience")}
          </h2>

          <p style={{ opacity: 0.9, lineHeight: 1.8 }}>
            {t(
              "about.storyText",
              "REGORIXA was formed by a group of market professionals with over 10 years of continuous experience in global financial markets, focused on building a stable, rule-based model for long-term participation across liquid markets."
            )}
          </p>

          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            {t("about.yearsLabel", "Team experience:")}{" "}
            <b>{t("about.yearsValue", "10+ years")}</b>
          </div>
        </div>

        {/* Team */}
        <div className="sectionBox" style={{ marginTop: 0 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>
            {t("about.teamTitle", "Professional Trading & Execution Team")}
          </h2>

          <p style={{ opacity: 0.9, lineHeight: 1.8 }}>
            {t(
              "about.teamText",
              "Our execution combines systematic tools with experienced human oversight. We apply structured risk controls, position sizing, and exposure limits to manage downside volatility across changing market conditions."
            )}
          </p>

          <ul style={{ opacity: 0.9, lineHeight: 1.9, marginTop: 10 }}>
            <li>{t("about.teamBullet1", "Rule-based execution and continuous monitoring")}</li>
            <li>{t("about.teamBullet2", "Strict risk limits and allocation discipline")}</li>
            <li>{t("about.teamBullet3", "Focus on consistency and capital preservation")}</li>
          </ul>
        </div>
      </div>

      {/* Principles */}
      <div className="sectionBox" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>
          {t("about.principlesTitle", "Our Principles")}
        </h2>

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          <div className="liftCard" style={{ padding: 14, borderRadius: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              {t("about.p1Title", "Transparency")}
            </div>
            <div style={{ opacity: 0.9, lineHeight: 1.7 }}>
              {t("about.p1Text", "Clear rules, requirements, and disclosures before participation.")}
            </div>
          </div>

          <div className="liftCard" style={{ padding: 14, borderRadius: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              {t("about.p2Title", "Risk Control")}
            </div>
            <div style={{ opacity: 0.9, lineHeight: 1.7 }}>
              {t("about.p2Text", "Structured allocation, exposure limits, and disciplined execution.")}
            </div>
          </div>

          <div className="liftCard" style={{ padding: 14, borderRadius: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              {t("about.p3Title", "Consistency")}
            </div>
            <div style={{ opacity: 0.9, lineHeight: 1.7 }}>
              {t("about.p3Text", "A long-term mindset built on repeatable, sustainable processes.")}
            </div>
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="sectionBox" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>
          {t("about.disclaimerTitle", "Important Notice")}
        </h2>

        <p style={{ opacity: 0.9, lineHeight: 1.8, marginBottom: 0 }}>
          {t(
            "about.disclaimerText",
            "Participation involves market risk. Returns are variable and not guaranteed. Please review the Legal page for full risk disclosures."
          )}
        </p>
      </div>

      <div style={{ height: 26 }} />
    </div>
  );
}

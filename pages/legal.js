import Nav from "../components/Nav";
import { useLanguage } from "../context/LanguageContext";
import translations from "../translations";

export default function Legal() {
  const { lang, dir } = useLanguage();

  const base = translations.en || {};
  const current = translations?.[lang] || base;
  const t = { ...base, ...current };

  const L = t.legal || base.legal || null;

  if (!L) {
    return (
      <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
        <Nav />
        <p>Legal content is missing in translations/en.js (key: legal).</p>
      </div>
    );
  }

  const sectionStyle = {
    marginTop: 22,
    padding: 18,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
  };

  const titleStyle = { fontWeight: 800, marginBottom: 6 };
  const textStyle = { opacity: 0.9, lineHeight: 1.7 };

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      <div style={{ marginTop: 20 }}>
        <h1 style={{ marginBottom: 6 }}>{L.legalIntroTitle}</h1>
        <p style={{ opacity: 0.85, maxWidth: 900 }}>{L.legalIntroText}</p>
      </div>

      <div style={sectionStyle}>
        <div style={titleStyle}>{L.noAdviceTitle}</div>
        <div style={textStyle}>{L.noAdviceText}</div>
      </div>

      <div style={sectionStyle}>
        <div style={titleStyle}>{L.noGuaranteeTitle}</div>
        <div style={textStyle}>{L.noGuaranteeText}</div>
      </div>

      <div style={sectionStyle}>
        <div style={titleStyle}>{L.riskDisclosureTitle}</div>
        <div style={textStyle}>{L.riskDisclosureText}</div>
      </div>

      <div style={sectionStyle}>
        <div style={titleStyle}>{L.capitalResponsibilityTitle}</div>
        <div style={textStyle}>{L.capitalResponsibilityText}</div>
      </div>

      <div style={sectionStyle}>
        <div style={titleStyle}>{L.operationsTitle}</div>
        <div style={textStyle}>{L.operationsText}</div>
      </div>

      <div style={sectionStyle}>
        <div style={titleStyle}>{L.jurisdictionTitle}</div>
        <div style={textStyle}>{L.jurisdictionText}</div>
      </div>

      <div style={{ ...sectionStyle, borderColor: "rgba(255,255,255,0.2)" }}>
        <div style={titleStyle}>{L.finalDisclaimerTitle}</div>
        <div style={textStyle}>{L.finalDisclaimerText}</div>
      </div>
    </div>
  );
}

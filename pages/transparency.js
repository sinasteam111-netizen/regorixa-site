import Nav from "../components/Nav";
import { useLanguage } from "../context/LanguageContext";
import translations from "../translations";

export default function Transparency() {
  const { lang, dir } = useLanguage();
  const base = translations.en || {};
  const current = translations[lang] || base;
  const t = { ...base, ...current };

  const rules = Array.isArray(t.rules) ? t.rules : [];

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      {/* HERO */}
      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">{t.transparencyTag}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {t.transparencyTagline}
          </span>
        </div>

        <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.2 }}>
          {t.transparencyTitle}
        </h1>

        <p className="p" style={{ marginTop: 12, maxWidth: 900 }}>
          {t.transparencyIntro}
        </p>

        <div className="btnRow" style={{ marginTop: 16 }}>
          <a className="btnGhost" href="/legal">{t.readLegal}</a>
          <a className="btnGhost" href="/faq">{t.heroFaq}</a>
        </div>
      </div>

      {/* RULES */}
      <div className="sectionBox" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>{t.transparencyRulesTitle}</h3>
        <ul style={{ opacity: 0.92, lineHeight: 1.8 }}>
          {rules.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>

      {/* TIMELINE */}
      <div className="sectionBox" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>{t.transparencyTimelineTitle}</h3>

        <div className="timeline">
          <div className="timelineItem liftCard">
            <div className="timelineTop">
              <span className="badge">{t.timelineDay0}</span>
              <div className="timelineTitle">{t.timelineStartTitle}</div>
            </div>
            <div className="muted">{t.timelineStartText}</div>
          </div>

          <div className="timelineItem liftCard">
            <div className="timelineTop">
              <span className="badge">{t.timelineMonth1}</span>
              <div className="timelineTitle">{t.timelineCycle1Title}</div>
            </div>
            <div className="muted">{t.timelineCycle1Text}</div>
          </div>

          <div className="timelineItem liftCard">
            <div className="timelineTop">
              <span className="badge">{t.timelineMonth2}</span>
              <div className="timelineTitle">{t.timelineLockTitle}</div>
            </div>
            <div className="muted">{t.timelineLockText}</div>
          </div>

          <div className="timelineItem liftCard">
            <div className="timelineTop">
              <span className="badge">{t.timelineWindow}</span>
              <div className="timelineTitle">{t.timelineWithdrawTitle}</div>
            </div>
            <div className="muted">{t.timelineWithdrawText}</div>
          </div>
        </div>
      </div>

      {/* DO / DON'T */}
      <div className="sectionBox" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>{t.transparencyDoDontTitle}</h3>

        <div className="twoCol">
          <div className="glassMini liftCard">
            <div className="legalTitle">{t.transparencyDo}</div>
            <ul className="planList">
              <li>{t.doItem1}</li>
              <li>{t.doItem2}</li>
              <li>{t.doItem3}</li>
            </ul>
          </div>

          <div className="glassMini liftCard">
            <div className="legalTitle">{t.transparencyDont}</div>
            <ul className="planList">
              <li>{t.dontItem1}</li>
              <li>{t.dontItem2}</li>
              <li>{t.dontItem3}</li>
            </ul>
          </div>
        </div>
      </div>

      <div style={{ height: 26 }} />
    </div>
  );
}

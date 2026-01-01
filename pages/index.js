import Nav from "../components/Nav";
import { useLanguage } from "../context/LanguageContext";

export default function Home() {
  const { t, dir } = useLanguage();
  if (!t) return <div className="container">Loading translations...</div>;

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      <div className="hero">
        <h1 className="h1">{t.title}</h1>
        <p className="subtitle">{t.subtitle}</p>

        <h2 className="h2">{t.investmentModelTitle}</h2>
        <p className="p">{t.investmentModelText}</p>
      </div>

      <div className="section">
        <ul className="rules">
          {t.rules.map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ul>

        <div className="hrTitle">{t.investmentPlansTitle}</div>

        <div className="cards">
          <div className="card">
            <div className="badge">{t.basePlanTitle}</div>
            <h3 className="cardTitle" style={{ marginTop: 10 }}>
              {t.basePlanTitle}
            </h3>
            <ul className="bullets">
              {t.basePlanBullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>

          <div className="card cardAlt">
            <div className="badge">{t.advancedPlanTitle}</div>
            <h3 className="cardTitle" style={{ marginTop: 10 }}>
              {t.advancedPlanTitle}
            </h3>
            <ul className="bullets">
              {t.advancedPlanBullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="btnRow">
          <button className="btn">{t.startButton}</button>
        </div>
      </div>
    </div>
  );
}

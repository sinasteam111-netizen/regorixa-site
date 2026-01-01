import Nav from "../components/Nav";
import { useLanguage } from "../context/LanguageContext";

export default function Transparency() {
  const { dir } = useLanguage();

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      <div className="hero">
        <h1 className="h1">Transparency & Terms</h1>
        <p className="subtitle">
          REGORIXA operates with transparency, responsibility, and clear investment rules.
        </p>
      </div>

      <div className="section">
        <h2 className="h2">Investment Rules</h2>
        <ul className="rules">
          <li>Minimum investment amount is 100 USDT.</li>
          <li>Investment can only be increased in increments of 100 USDT.</li>
          <li>Principal funds are locked for a minimum of 2 months.</li>
          <li>
            Withdrawal requests can be submitted within 2 days after receiving the second monthly
            profit.
          </li>
          <li>Approved withdrawals are processed within 24 hours.</li>
        </ul>
      </div>

      <div className="section">
        <h2 className="h2">Subscription Plans</h2>
        <ul className="rules">
          <li>Base Plan: 3% – 5% monthly return.</li>
          <li>Advanced Plan: 5% – 7% monthly return.</li>
          <li>Subscription fees are non-refundable.</li>
          <li>Returns are calculated monthly.</li>
        </ul>
      </div>

      <div className="section">
        <h2 className="h2">Risk Disclosure</h2>
        <p className="p">
          Cryptocurrency investments involve risk. REGORIXA does not guarantee profits and users
          acknowledge the possibility of financial loss.
        </p>
      </div>

      <div className="section">
        <h2 className="h2">Commitment</h2>
        <p className="p">
          REGORIXA is committed to responsible fund management, system transparency, and timely
          processing of valid withdrawal requests.
        </p>
      </div>
    </div>
  );
}

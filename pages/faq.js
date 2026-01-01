import { useLanguage } from "../context/LanguageContext";

export default function FAQ() {
  const { dir } = useLanguage();

  const faqs = [
    {
      q: "How does REGORIXA generate revenue to pay profits?",
      a: "REGORIXA generates revenue through a combination of algorithmic execution systems (trading automation) and a professional trading team using diversified strategies across liquid markets. Risk is managed through position sizing, exposure limits, and strategy diversification. Returns depend on market conditions and are not guaranteed.",
    },
    {
      q: "Do investors share trading losses with REGORIXA?",
      a: "Market performance can fluctuate. REGORIXA applies structured risk controls to reduce downside exposure; however, all investing involves risk, and losses may occur. We prioritize capital preservation practices, but outcomes cannot be guaranteed.",
    },
    {
      q: "What plans are available?",
      a: "REGORIXA offers two plans: Base Plan and Advanced Plan. Each plan has different subscription requirements and target return ranges.",
    },
    {
      q: "What is the minimum investment for the Base Plan?",
      a: "The minimum investment for the Base Plan is 100 USDT.",
    },
    {
      q: "What is the minimum investment for the Advanced Plan?",
      a: "The minimum investment for the Advanced Plan is 300 USDT.",
    },
    {
      q: "What is the expected monthly return for the Advanced Plan?",
      a: "The Advanced Plan targets an estimated 5%–7% monthly return based on strategy performance. Returns may vary and are not guaranteed.",
    },
    {
      q: "When can I withdraw my principal?",
      a: "The principal is locked for the first 2 months after investment. After receiving the second monthly profit, users may request a withdrawal within the allowed request window (as shown in the platform rules).",
    },
    {
      q: "How long does withdrawal processing take?",
      a: "Approved withdrawal requests are processed within 24 hours.",
    },
  ];

  return (
    <div
      className="container"
      dir={dir}
      style={{ textAlign: dir === "rtl" ? "right" : "left" }}
    >
      <h1 style={{ marginBottom: 8 }}>FAQ</h1>
      <p style={{ opacity: 0.85, marginTop: 0, marginBottom: 18 }}>
        Common questions about REGORIXA. If you need support, contact us.
      </p>

      <div style={{ display: "grid", gap: 14 }}>
        {faqs.map((item, idx) => (
          <div
            key={idx}
            style={{
              padding: 16,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>
              {item.q}
            </h3>
            <p style={{ margin: 0, opacity: 0.92, lineHeight: 1.65 }}>
              {item.a}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

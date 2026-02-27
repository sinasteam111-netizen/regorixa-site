import { useMemo, useState } from "react";
import Head from "next/head";
import Nav from "../components/Nav";
import { useLanguage } from "../context/LanguageContext";
import translations from "../translations";

function AccordionItem({ q, a, dir, isOpen, onToggle }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.03)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          padding: "14px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "rgba(255,255,255,0.92)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          textAlign: dir === "rtl" ? "right" : "left",
          fontSize: 15,
          fontWeight: 700,
        }}
        aria-expanded={isOpen}
      >
        <span>{q}</span>
        <span
          style={{
            display: "inline-flex",
            width: 28,
            height: 28,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid rgba(255,255,255,0.12)",
            background: isOpen ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          {isOpen ? "−" : "+"}
        </span>
      </button>

      {isOpen && (
        <div
          style={{
            padding: "0 16px 14px 16px",
            color: "rgba(255,255,255,0.86)",
            lineHeight: 1.7,
            fontSize: 14,
          }}
        >
          {a}
        </div>
      )}
    </div>
  );
}

function stripText(x) {
  // FAQPage schema بهتره plain text باشه
  return String(x ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default function FAQ() {
  const { lang, dir } = useLanguage();
  const base = translations.en;
  const current = translations[lang] || base;

  // fallback
  const faq = current.faq || base.faq;

  // آکاردئون: فقط یکی باز باشد (حرفه‌ای‌تر)
  const [openKey, setOpenKey] = useState(null);

  const toggle = (key) => {
    setOpenKey((prev) => (prev === key ? null : key));
  };

  // ✅ FAQ Schema فقط برای EN (برای اینکه گوگل درست بفهمه)
  const faqJsonLd = useMemo(() => {
    if (lang !== "en") return null;

    const sections = Array.isArray(faq?.sections) ? faq.sections : [];
    const items = sections.flatMap((sec) => (Array.isArray(sec?.items) ? sec.items : []));

    const mainEntity = items
      .map((it) => {
        const q = stripText(it?.q);
        const a = stripText(it?.a);
        if (!q || !a) return null;

        return {
          "@type": "Question",
          name: q,
          acceptedAnswer: {
            "@type": "Answer",
            text: a,
          },
        };
      })
      .filter(Boolean)
      .slice(0, 50); // گوگل معمولاً بهتره تعداد خیلی زیاد نباشه

    if (mainEntity.length === 0) return null;

    return {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity,
    };
  }, [faq, lang]);

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Head>
        {/* Schema مخصوص FAQ */}
        {faqJsonLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
          />
        )}
      </Head>

      <Nav />

      <div style={{ marginTop: 22 }}>
        <h1 style={{ margin: 0, fontSize: 26 }}>{faq?.title || "FAQ"}</h1>
        <p style={{ marginTop: 10, opacity: 0.85, lineHeight: 1.7, maxWidth: 820 }}>
          {faq?.intro || ""}
        </p>
      </div>

      <div style={{ marginTop: 18, display: "grid", gap: 18 }}>
        {(faq?.sections || []).map((sec, sIdx) => (
          <div key={sIdx}>
            <h2 style={{ margin: "6px 0 10px 0", fontSize: 16, opacity: 0.95 }}>
              {sec.title}
            </h2>

            <div style={{ display: "grid", gap: 12 }}>
              {sec.items.map((it, iIdx) => {
                const key = `${sIdx}-${iIdx}`;
                return (
                  <AccordionItem
                    key={key}
                    q={it.q}
                    a={it.a}
                    dir={dir}
                    isOpen={openKey === key}
                    onToggle={() => toggle(key)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ height: 26 }} />
    </div>
  );
};
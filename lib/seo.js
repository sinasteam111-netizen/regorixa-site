// lib/seo.js
export const SITE = {
  name: "REGORIXA",
  url: "https://regorixa.com",
  defaultTitle: "REGORIXA",
  defaultDescription:
    "REGORIXA is a secure and scalable investment and wallet management platform.",
  ogImage: "/og.png",
  locale: "en_US",
};

// صفحات خصوصی / حساس -> noindex
export const NOINDEX_PATH_PREFIXES = ["/dashboard", "/admin"];

// صفحه‌های عمومی و تنظیمات پیشنهادی
export const PAGE_META = {
  "/": {
    title: "Secure Investment Platform",
    description:
      "Manage wallets, track investments, and access secure plans with REGORIXA.",
    changefreq: "weekly",
    priority: "1.0",
  },

  // ✅ Navbar pages (public)
  "/transparency": {
    title: "Transparency",
    description:
      "Platform transparency, participation rules, disclosures, and operational details.",
    changefreq: "monthly",
    priority: "0.8",
  },
  "/faq": {
    title: "FAQ",
    description:
      "Answers to common questions about REGORIXA plans, rules, withdrawals, and security.",
    changefreq: "monthly",
    priority: "0.7",
  },
  "/about": {
    title: "About",
    description: "Learn what REGORIXA is and how the platform works.",
    changefreq: "monthly",
    priority: "0.7",
  },
  "/legal": {
    title: "Legal & Compliance",
    description: "Legal terms, risk disclosures, and compliance information for REGORIXA.",
    changefreq: "yearly",
    priority: "0.6",
  },

  // ✅ Plans (public)
  "/plans/base": {
    title: "Base Plan",
    description: "Explore the REGORIXA Base plan features and benefits.",
    changefreq: "weekly",
    priority: "0.8",
  },
  "/plans/advanced": {
    title: "Advanced Plan",
    description: "Explore the REGORIXA Advanced plan features and benefits.",
    changefreq: "weekly",
    priority: "0.8",
  },
  "/plans/vip": {
    title: "VIP Plan",
    description: "Explore the REGORIXA VIP plan features and benefits.",
    changefreq: "weekly",
    priority: "0.8",
  },

  // ✅ Auth pages (public but lower priority)
  "/login": {
    title: "Login",
    description: "Login to your REGORIXA account securely.",
    changefreq: "monthly",
    priority: "0.4",
  },
  "/register": {
    title: "Register",
    description: "Create your REGORIXA account in minutes.",
    changefreq: "monthly",
    priority: "0.4",
  },

  // ✅ Security page (public)
  "/security": {
    title: "Security",
    description: "Learn how REGORIXA keeps your account and data secure.",
    changefreq: "monthly",
    priority: "0.6",
  },
};

export function isNoindexPath(pathname = "") {
  const clean = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  return NOINDEX_PATH_PREFIXES.some(
    (p) => clean === p || clean.startsWith(p + "/")
  );
}

export function getMetaForPath(pathname = "") {
  const cleanRaw = pathname.split("?")[0] || "/";
  const clean = cleanRaw === "/" ? "/" : cleanRaw.replace(/\/+$/, "");
  const page = PAGE_META[clean];

  const title = page?.title
    ? `${page.title} | ${SITE.name}`
    : SITE.defaultTitle;

  const description = page?.description || SITE.defaultDescription;

  return {
    title,
    description,
    canonical: `${SITE.url}${clean === "/" ? "" : clean}`,
    ogImageAbs: `${SITE.url}${SITE.ogImage}`,
    noindex: isNoindexPath(clean),
  };
}
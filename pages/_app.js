import "../styles/globals.css";
import { LanguageProvider } from "../context/LanguageContext";
import "../styles/regorixa.css";
import Head from "next/head";
import { useRouter } from "next/router";
import { getMetaForPath, SITE } from "../lib/seo";

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const meta = getMetaForPath(router.asPath || "/");

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.url,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE.url}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.name,
    url: SITE.url,
    logo: `${SITE.url}/icon-512.png`,
    sameAs: [],
  };

  return (
    <LanguageProvider>
      <Head>
        {/* Basic SEO */}
        <title>{meta.title}</title>
        <meta name="description" content={meta.description} />
        <link rel="canonical" href={meta.canonical} />

        {/* Robots */}
        <meta
          name="robots"
          content={meta.noindex ? "noindex,nofollow" : "index,follow"}
        />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE.name} />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.description} />
        <meta property="og:url" content={meta.canonical} />
        <meta property="og:image" content={meta.ogImageAbs} />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={meta.title} />
        <meta name="twitter:description" content={meta.description} />
        <meta name="twitter:image" content={meta.ogImageAbs} />

        {/* Structured Data (Schema.org) — فقط برای صفحات عمومی */}
        {!meta.noindex && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
          />
        )}
        {!meta.noindex && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
          />
        )}
      </Head>

      <Component {...pageProps} />
    </LanguageProvider>
  );
};
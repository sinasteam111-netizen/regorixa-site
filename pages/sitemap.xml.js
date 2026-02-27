import { SITE, PAGE_META, NOINDEX_PATH_PREFIXES } from "../lib/seo";

function normalizePath(p) {
  if (!p) return "/";
  if (p === "/") return "/";
  return String(p).split("?")[0].replace(/\/+$/, "") || "/";
}

function isNoindex(path) {
  const clean = normalizePath(path);
  return NOINDEX_PATH_PREFIXES.some((p) => clean === p || clean.startsWith(p + "/"));
}

function generateSiteMap() {
  // از PAGE_META می‌خونه و private ها رو حذف می‌کنه
  const keys = Object.keys(PAGE_META)
    .map(normalizePath)
    .filter((p) => !isNoindex(p));

  // مرتب‌سازی: اول / بعد بقیه به ترتیب الفبا
  keys.sort((a, b) => {
    if (a === "/") return -1;
    if (b === "/") return 1;
    return a.localeCompare(b);
  });

  const urls = keys
    .map((path) => {
      const info = PAGE_META[path] || {};
      const loc = `${SITE.url}${path === "/" ? "" : path}`;
      const changefreq = info.changefreq || "weekly";
      const priority = info.priority || (path === "/" ? "1.0" : "0.7");

      return `
  <url>
    <loc>${loc}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export async function getServerSideProps({ res }) {
  const sitemap = generateSiteMap();

  res.setHeader("Content-Type", "text/xml");
  res.write(sitemap);
  res.end();

  return { props: {} };
}

export default function SiteMap() {
  return null;
}
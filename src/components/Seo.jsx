import { useEffect } from "react";

/**
 * Per-route document head for a client-rendered SPA.
 *
 * Every route here serves the same index.html, so without this each page
 * inherits the consumer-app title and description — meaning /restaurants would
 * show up in Google as "BillTap — Split Bills in 30 Seconds" with copy about
 * splitting receipts, which is the wrong pitch for a restaurant owner.
 *
 * Deliberately dependency-free: react-helmet-async would add a provider and a
 * bundle for what is a handful of DOM writes.
 *
 * Note there is no cleanup on unmount. Routes animate with AnimatePresence, so
 * the outgoing page unmounts *after* the incoming one mounts — restoring
 * defaults on unmount would clobber the new page's tags. Each route sets its
 * own values instead.
 */

const SITE = "https://billtap.app";
// 1200x630 card built by scripts/build-brand-images.mjs. A square app icon
// gets letterboxed or cropped by every social scraper.
const DEFAULT_IMAGE = `${SITE}/img/og-default.png`;

function tag(selector, create) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  return el;
}

function meta(name, content, attr = "name") {
  if (!content) return;
  const el = tag(`meta[${attr}="${name}"]`, () => {
    const m = document.createElement("meta");
    m.setAttribute(attr, name);
    return m;
  });
  el.setAttribute("content", content);
}

// Same lookup-or-create shape as meta(): keyed by path + index so a route
// with multiple schema objects (e.g. SoftwareApplication + FAQPage) gets
// distinct tags that get replaced, not duplicated, on re-render.
function jsonLd(id, data) {
  if (!data) return;
  const el = tag(`script[data-seo-schema="${id}"]`, () => {
    const s = document.createElement("script");
    s.type = "application/ld+json";
    s.setAttribute("data-seo-schema", id);
    return s;
  });
  el.textContent = JSON.stringify(data);
}

// Organization schema. Moved out of index.html, which is guaranteed to carry
// zero inline <script> blocks so script-src never needs 'unsafe-inline'
// (src/csp.test.mjs enforces it). Emitting here also reaches further: prerender
// captures the DOM after this effect runs, so every prerendered route gets it.
/**
 * Who is behind this, in the markup and not only in the footer.
 *
 * ── Why the extra four lines ────────────────────────────────────────────────
 *
 * This block was name, url, logo and email — enough to identify the site and
 * nothing that says anyone is actually here. For a solo founder with no
 * customer logos and no third-party ratings, the credibility signals that
 * exist are a real person and a phone that rings, and neither was being
 * claimed anywhere a crawler reads.
 *
 * Every field below is already public on the site: the founder's name is in
 * the footer of every page, and the phone number and support address are on
 * /restaurants. This is not new information, it is the same information said
 * in the format search engines and answer engines parse.
 *
 * `areaServed` is US because it genuinely is: Venmo, Cash App and Zelle are
 * US-only rails and the support line is a US number.
 *
 * Still absent, deliberately: aggregateRating, review, and any award or
 * membership. There are no customers yet, so all of them would be invented,
 * and fabricated credibility markup is what earns a manual action rather than
 * a ranking.
 */
const ORGANIZATION = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "BillTap",
  url: "https://billtap.app",
  logo: "https://billtap.app/icons/icon-192.png",
  email: "hello@billtap.app",
  telephone: "+1-702-844-0938",
  founder: {
    "@type": "Person",
    name: "Kai Cogmon",
    url: "https://billtap.app/about",
  },
  areaServed: { "@type": "Country", name: "US" },
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "sales",
    telephone: "+1-702-844-0938",
    email: "alerts@billtap.app",
    areaServed: "US",
    availableLanguage: "English",
  },
};

export default function Seo({
  title,
  description,
  path = "/",
  image = DEFAULT_IMAGE,
  noindex = false,
  type = "website",
  schema = null, // a single JSON-LD object, or an array of them
}) {
  useEffect(() => {
    const url = `${SITE}${path}`;

    if (title) document.title = title;
    meta("description", description);

    // Canonical matters here: /Restaurants redirects to /restaurants, and ad
    // traffic arrives with ?utm_* on the end. Both should consolidate to one URL.
    tag('link[rel="canonical"]', () => {
      const l = document.createElement("link");
      l.setAttribute("rel", "canonical");
      return l;
    }).setAttribute("href", url);

    meta("robots", noindex ? "noindex, nofollow" : "index, follow");

    meta("og:title", title, "property");
    meta("og:description", description, "property");
    meta("og:url", url, "property");
    meta("og:type", type, "property");
    meta("og:image", image, "property");
    meta("og:site_name", "BillTap", "property");

    meta("twitter:card", "summary_large_image");
    meta("twitter:title", title);
    meta("twitter:description", description);
    meta("twitter:image", image);

    // Fixed id, not path-keyed: one Organization tag replaced on navigation
    // rather than one accumulating per route.
    jsonLd("seo-organization", ORGANIZATION);

    if (schema) {
      const schemas = Array.isArray(schema) ? schema : [schema];
      schemas.forEach((s, i) => jsonLd(`${path}-${i}`, s));
    }
  }, [title, description, path, image, noindex, type, schema]);

  return null;
}

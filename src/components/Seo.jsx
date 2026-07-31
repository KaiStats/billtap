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

export default function Seo({
  title,
  description,
  path = "/",
  image = DEFAULT_IMAGE,
  noindex = false,
  type = "website",
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
  }, [title, description, path, image, noindex, type]);

  return null;
}

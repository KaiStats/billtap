/**
 * GET /sitemap-restaurants.xml — the customers' pages, so Google can find them.
 *
 * ── Why unblocking robots.txt was not enough on its own ─────────────────────
 *
 * `/r/<slug>` is a paying restaurant's permanent page and was disallowed for
 * years on a mistaken premise. Allowing it back fixed link previews, which is
 * real — but it does not get a single page indexed, because nothing on the
 * internet links to them. They are reached by scanning a QR code on a table.
 * A crawler discovers pages by following links or by reading a sitemap, and
 * the static sitemap.xml lists marketing routes only.
 *
 * So without this file, allowing the crawl bought half the benefit. This is
 * the other half: the only discovery path those pages have.
 *
 * ── Who is in it ────────────────────────────────────────────────────────────
 *
 * Entitled, non-demo restaurants. Both halves matter and for different
 * reasons.
 *
 * Demo rows are excluded because they carry a real business's name, that
 * business agreed to nothing, and they are deleted within the day —
 * everything migration 0013 and the noindex in TableEntry.jsx exist to
 * protect. A sitemap is an explicit request to index; submitting a page we
 * are about to delete, for a stranger's restaurant, is the exact harm.
 *
 * Reference accounts are excluded for the same reason wearing different
 * clothes, and this one nearly shipped.
 *
 * `reference_account` exists to keep a row off the billing clock — see
 * migration 0023. It says nothing about whether that restaurant agreed to be
 * published. The row this was written for belonged to a prospect who had not
 * said yes, and a fabricated claim that they were a customer had already been
 * removed from the marketing page once, on the grounds that the owner can read
 * it and would be right to walk. That row has since been renamed to a
 * placeholder and its slug randomised, so nothing in the database carries a
 * real business's name today — but the next reference account will, and the
 * rule has to hold before anyone remembers to check.
 *
 * Listing one here makes that claim again, in a file addressed to Google, and
 * gets a page bearing a real business's name into search results. Every
 * protection the demo path has — an unguessable slug, a noindex, deletion
 * within a day — is bypassed by a reference row simply because `demo` is
 * false. So the filter is entitlement AND being an actual customer, and those
 * turn out not to be the same question.
 *
 * Unentitled rows are excluded because SEO is part of what the $149 buys. A
 * restaurant whose trial ran out or who cancelled still has a page — the
 * guest-facing half never stops working, see shared/entitlement.js — but we
 * are not going to keep asking Google to rank it. `isEntitled` is the same
 * function every other gate in this codebase uses, so there is no second
 * definition of "paying" to drift.
 *
 * ── This is a public customer list ──────────────────────────────────────────
 *
 * Worth stating plainly, because it is a business decision and not only a
 * technical one: anyone can read this file, including a competitor, and learn
 * exactly which restaurants pay for BillTap and how many there are. That is
 * ordinary for SaaS and it is the price of the pages being findable at all.
 * If that ever stops being an acceptable trade, this route is the one file to
 * remove.
 *
 * Nothing beyond the slug is exposed. Not the owner, not the alert address,
 * not the plan, not the Stripe ids — the same allow-list discipline
 * getPublicRestaurant applies, for the same reason.
 */

import { serviceRole } from '../lib/data.js';
import { isEntitled } from '../../shared/entitlement.js';

/** Google's own ceiling is 50,000 URLs per sitemap. Far past any near future. */
const MAX_URLS = 50000;

/**
 * Cached at the edge for an hour.
 *
 * A sitemap is polled by crawlers on their own schedule and its contents move
 * when somebody signs up, which is not a per-second event. Without this every
 * crawler hit is a database read on a public, unauthenticated URL — which is
 * a free denial-of-wallet button for anyone who notices it.
 */
const CACHE_SECONDS = 3600;

const SITE = 'https://billtap.app';

/**
 * XML-escape. Slugs are `[a-z0-9-]` by construction — see slugify and the demo
 * alphabet — so this should never have anything to do. It is here because
 * "should never" is not a guarantee about rows that predate the rule, and an
 * unescaped ampersand does not fail loudly: it silently invalidates the whole
 * document for every crawler that reads it.
 */
function xml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** YYYY-MM-DD, or null when the row carries no usable timestamp. */
function lastmod(row) {
  const raw = row?.updated_date || row?.created_date;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function document(entries) {
  const urls = entries.map((e) => [
    '  <url>',
    `    <loc>${xml(e.loc)}</loc>`,
    e.lastmod ? `    <lastmod>${xml(e.lastmod)}</lastmod>` : null,
    '    <changefreq>weekly</changefreq>',
    '    <priority>0.7</priority>',
    '  </url>',
  ].filter(Boolean).join('\n')).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Restaurants using BillTap. Generated from the database, not committed:
  see worker/routes/restaurant-sitemap.js. Demo pages are deliberately absent.
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function respond(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
    },
  });
}

export async function onRequestGet({ env }) {
  try {
    const rows = await serviceRole(env).entity('Restaurant').filter(
      {},
      {
        // The allow-list is the point. `demo` and the plan columns are read to
        // decide inclusion and are never emitted.
        select: 'slug,demo,demo_expires_at,plan,trial_ends_at,current_period_end,reference_account,updated_date,created_date',
        limit: MAX_URLS,
      },
    );

    const entries = (Array.isArray(rows) ? rows : [])
      .filter((r) => r && r.slug && !r.demo && !r.reference_account && isEntitled(r))
      .slice(0, MAX_URLS)
      .map((r) => ({ loc: `${SITE}/r/${r.slug}`, lastmod: lastmod(r) }));

    return respond(document(entries));
  } catch (err) {
    /**
     * A valid, empty sitemap rather than a 500.
     *
     * A crawler that receives an error on a sitemap it has been told to read
     * may keep the previous contents or may drop them; neither is under our
     * control and both are worse than an honest empty document. An empty
     * urlset says "nothing to add right now" and costs nothing — a page
     * already indexed is not removed by its absence from a sitemap.
     */
    console.error('restaurant-sitemap: could not build', err?.message);
    return respond(document([]));
  }
}

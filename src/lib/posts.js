/**
 * The blog, as data, and the markup that describes it to a crawler.
 *
 * ── Why this is a module ────────────────────────────────────────────────────
 *
 * These four posts target the highest commercial-intent queries this domain
 * has any business ranking for — an owner typing "podium alternative for
 * restaurants" is further down the funnel than anyone landing on the home
 * page — and every one of them shipped with no structured data at all. No
 * article markup, no author, no date, no breadcrumb. A crawler could tell
 * they were pages; nothing told it they were written by a person, when, or
 * where they sat in the site.
 *
 * The index page already held the titles, dates and excerpts. Retyping them
 * into schema on each post is how markup and page silently stop agreeing six
 * months from now — the same drift the FAQ schema on the landing page avoids
 * by deriving from the array the page renders. So the list lives here once and
 * both sides read it.
 *
 * ── On the dates ────────────────────────────────────────────────────────────
 *
 * "August 2026" is all the index has ever claimed, so `2026-08` is all that
 * goes in the markup. ISO 8601 permits month precision, and inventing a day of
 * the month to look more precise would be inventing a fact about when
 * something was published.
 */

/** The one true post list. Order is editorial: strongest commercial intent first. */
export const POSTS = [
  {
    slug: 'podium-alternative',
    title: 'Podium Alternative for Restaurants',
    date: 'August 2026',
    published: '2026-08',
    excerpt:
      'Podium asks for reviews by text, days later. BillTap asks at the table, while a manager can still fix the night.',
  },
  {
    slug: 'qr-without-pos-change',
    title: 'QR Code Bill Splitting Without Changing Your POS',
    date: 'August 2026',
    published: '2026-08',
    excerpt:
      'No integration, no new hardware, nothing for servers to learn. It runs beside Toast or Clover, not inside them.',
  },
  {
    slug: 'catch-1-star-early',
    title: 'Catch a 1-Star Review Before It Gets Posted',
    date: 'August 2026',
    published: '2026-08',
    excerpt:
      'A low rating pings you while the guest is still in the dining room — two minutes to make it right in person.',
  },
  {
    slug: 'cost-of-one-lost-regular',
    title: 'The Math on One Lost Regular',
    date: 'August 2026',
    published: '2026-08',
    excerpt:
      "A weekly regular is worth four figures a year. Here's what one un-caught bad night actually costs you.",
  },
];

/** Convenience for the post pages, which know their own slug and nothing else. */
export function postBySlug(slug) {
  return POSTS.find((p) => p.slug === slug) || null;
}

const SITE = 'https://billtap.app';

/**
 * BlogPosting plus the breadcrumb trail that puts it in the site.
 *
 * ── The author is the point ─────────────────────────────────────────────────
 *
 * A named human who publishes analysis and answers the phone is the strongest
 * credibility signal this domain has, and the markup was not making it. Kai
 * Cogmon is already in the footer of every page; saying so in the schema costs
 * nothing and is the sort of thing Google's own guidance on experience and
 * authorship asks for.
 *
 * `publisher` is the same organisation the site-wide Organization block
 * describes, repeated here because an article is expected to name its own.
 *
 * ── The breadcrumb ──────────────────────────────────────────────────────────
 *
 * Without it a result is a bare URL. With it Google can render
 * "billtap.app › Blog › Podium Alternative", which reads as a site rather than
 * a stray page — and these are the pages most worth making look legitimate,
 * since they are the ones an owner reaches while comparing vendors.
 *
 * @param slug the post's slug, matching POSTS
 * @param description the page's own meta description, reused as the abstract
 * @returns an array of JSON-LD objects for <Seo schema={...}>
 */
export function postSchema(slug, description) {
  const post = postBySlug(slug);
  if (!post) return [];

  const url = `${SITE}/blog/${post.slug}`;

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: description || post.excerpt,
      url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      // Month precision, because that is the precision the site claims.
      datePublished: post.published,
      author: {
        '@type': 'Person',
        name: 'Kai Cogmon',
        url: `${SITE}/about`,
      },
      publisher: {
        '@type': 'Organization',
        name: 'BillTap',
        url: SITE,
        logo: {
          '@type': 'ImageObject',
          url: `${SITE}/icons/icon-192.png`,
        },
      },
      isPartOf: {
        '@type': 'Blog',
        name: 'BillTap Blog',
        url: `${SITE}/blog`,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'BillTap', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog` },
        { '@type': 'ListItem', position: 3, name: post.title, item: url },
      ],
    },
  ];
}

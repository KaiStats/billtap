/**
 * Art direction for the /restaurants landing page.
 *
 * Fifteen images generated with Higgsfield (Nano Banana 2), shot to one brief:
 * warm tungsten hospitality photography, deep blacks, amber highlights keyed to
 * the page's gold. Every frame is deliberately text-free — rendered lettering is
 * the tell that gives generated imagery away, so the type all lives in the DOM.
 *
 * These currently point at Higgsfield's CDN. To self-host — recommended before
 * you drive paid traffic here, since the CDN path is tied to a Higgsfield
 * account — run:
 *
 *     node scripts/fetch-restaurant-art.mjs
 *
 * That writes sized WebP into public/img/restaurants/. Then flip SELF_HOSTED
 * below to true. No other file changes.
 *
 * Nothing on the page depends on these loading: every image sits on top of a
 * CSS-composed gradient, so a dead URL degrades to the gradient treatment
 * rather than a broken box.
 */

const SELF_HOSTED = false;

const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3F5ssCqR5J7p1iLhp9GPzJjUxk5";

const REMOTE = {
  hero: "hf_20260730_002222_1f944279-3679-4d82-a453-81ba0e5ab0cf.png",
  band: "hf_20260730_004657_0bf914b5-d02c-4da6-9708-562842b7ee93.png",

  "pillar-alert": "hf_20260730_002225_2ee1bb01-c91f-40c6-a0d5-01e25a63c3e6.png",
  "pillar-reviews": "hf_20260730_002236_20c9a932-e1dd-473a-b396-38f3e19b9010.png",
  "pillar-list": "hf_20260730_002625_51ea41a2-1d60-44fc-bd4b-080278f39e17.png",
  "pillar-report": "hf_20260730_002631_53645a15-1d0f-459c-8e20-e85d0525d975.png",

  "step-scan": "hf_20260730_004647_ed8e6c6a-8465-47a5-9f1d-8fbab8443379.png",
  "step-split": "hf_20260730_005413_f51f2986-0581-4936-b77c-c810fb684ac6.png",
  "step-rate": "hf_20260730_004654_d46ba576-f934-496e-a70a-82dad8028e1a.png",

  "strip-scan": "hf_20260730_004601_125aa9ea-c8c8-49cf-9ebe-bdafc1652f2e.png",
  // Re-rendered from the original so the check actually reads as a printed check.
  "strip-split": "hf_20260730_005015_840d0e84-d10d-4c27-a9e2-300654aa8729.png",
  "strip-rate": "hf_20260730_004619_86342850-f665-4365-9dc2-ccc8b5715eee.png",
  "strip-data": "hf_20260730_004622_70b9ce11-9a72-4917-8bc6-dda5434a8ae4.png",
  "strip-pos": "hf_20260730_004627_2856afc2-7ed2-4127-b3dc-90703cbd233e.png",
  "strip-setup": "hf_20260730_004630_cd65722d-9673-4286-9db2-73a2007b6e14.png",
};

/** Resolve an art key to a URL. Unknown keys return null so callers show the gradient. */
export function art(name) {
  if (SELF_HOSTED) return `/img/restaurants/${name}.webp`;
  const file = REMOTE[name];
  return file ? `${CDN}/${file}` : null;
}

// Kept for any older import sites.
export const HERO_IMAGE = art("hero");
export const DETAIL_IMAGE = art("band");

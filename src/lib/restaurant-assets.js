/**
 * Art direction for the /restaurants landing page.
 *
 * Fifteen images generated with Higgsfield (Nano Banana 2), shot to one brief:
 * warm tungsten hospitality photography, deep blacks, amber highlights keyed to
 * the page's gold. Every frame is deliberately text-free — rendered lettering is
 * the tell that gives generated imagery away, so the type all lives in the DOM.
 *
 * ── Self-hosting ────────────────────────────────────────────────────────────
 *
 *     node scripts/fetch-art.mjs
 *
 * downloads each original once and re-encodes it to WebP at the widths each
 * slot actually renders, into public/img/restaurants/. Then set SELF_HOSTED to
 * true and the page emits srcset/sizes, so the browser picks the smallest file
 * that fits — on a phone that is the 240px strip thumbnail, not the 2400px PNG.
 *
 * Nothing on the page depends on any of this loading: every image sits on top
 * of a CSS-composed gradient, so a dead URL degrades to the gradient treatment
 * rather than a broken box.
 */
// Relative, not the "@/" alias: scripts/fetch-art.mjs imports this file in
// plain Node, which cannot resolve Vite's path alias.
import { createArt } from "./art.js";

const SELF_HOSTED = true;

const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3F5ssCqR5J7p1iLhp9GPzJjUxk5";

const LOCAL_DIR = "/img/restaurants";

/**
 * How each slot is rendered here, and therefore which widths are worth
 * generating. `sizes` mirrors the grids in Restaurants.jsx.
 *
 * Page-owned rather than shared with /: this page's steps sit three across
 * where the landing page's sit four, and the two sets of originals differ in
 * resolution, so neither the `sizes` hints nor the width ladders can be common.
 */
export const ROLES = {
  hero: {
    widths: [640, 1280, 1920, 2560],
    sizes: "100vw",
  },
  band: {
    widths: [640, 1280, 2000],
    sizes: "(max-width: 1200px) 100vw, 1152px",
  },
  pillar: {
    // Four across at 1152px container → ~270px CSS, so ~540px at 2x.
    widths: [320, 640, 1100],
    sizes: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw",
  },
  step: {
    // Three across → ~360px CSS, ~720px at 2x.
    widths: [400, 800, 1200],
    sizes: "(max-width: 640px) 100vw, 33vw",
  },
  strip: {
    // Six across → ~190px CSS, ~380px at 2x. The originals are 2400px.
    widths: [240, 480, 640],
    sizes: "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 17vw",
  },
};

/** name → { file: CDN filename, role: key of ROLES }. */
export const ART_MANIFEST = {
  hero: { file: "hf_20260730_002222_1f944279-3679-4d82-a453-81ba0e5ab0cf.png", role: "hero" },
  band: { file: "hf_20260730_004657_0bf914b5-d02c-4da6-9708-562842b7ee93.png", role: "band" },

  "pillar-alert": { file: "hf_20260730_002225_2ee1bb01-c91f-40c6-a0d5-01e25a63c3e6.png", role: "pillar" },
  "pillar-reviews": { file: "hf_20260730_002236_20c9a932-e1dd-473a-b396-38f3e19b9010.png", role: "pillar" },
  "pillar-list": { file: "hf_20260730_002625_51ea41a2-1d60-44fc-bd4b-080278f39e17.png", role: "pillar" },
  "pillar-report": { file: "hf_20260730_002631_53645a15-1d0f-459c-8e20-e85d0525d975.png", role: "pillar" },

  "step-scan": { file: "hf_20260730_004647_ed8e6c6a-8465-47a5-9f1d-8fbab8443379.png", role: "step" },
  // Recast from the original render.
  "step-split": { file: "hf_20260730_005413_f51f2986-0581-4936-b77c-c810fb684ac6.png", role: "step" },
  "step-rate": { file: "hf_20260730_004654_d46ba576-f934-496e-a70a-82dad8028e1a.png", role: "step" },

  "strip-scan": { file: "hf_20260730_004601_125aa9ea-c8c8-49cf-9ebe-bdafc1652f2e.png", role: "strip" },
  // Re-rendered so the check reads as a printed check.
  "strip-split": { file: "hf_20260730_005015_840d0e84-d10d-4c27-a9e2-300654aa8729.png", role: "strip" },
  "strip-rate": { file: "hf_20260730_004619_86342850-f665-4365-9dc2-ccc8b5715eee.png", role: "strip" },
  "strip-data": { file: "hf_20260730_004622_70b9ce11-9a72-4917-8bc6-dda5434a8ae4.png", role: "strip" },
  "strip-pos": { file: "hf_20260730_004627_2856afc2-7ed2-4127-b3dc-90703cbd233e.png", role: "strip" },
  "strip-setup": { file: "hf_20260730_004630_cd65722d-9673-4286-9db2-73a2007b6e14.png", role: "strip" },
};

export const SELF_HOSTED_RESTAURANTS = SELF_HOSTED;
export const RESTAURANTS_DIR = LOCAL_DIR;

/** True when the page is serving re-encoded local WebP rather than CDN PNGs. */
export const isSelfHosted = () => SELF_HOSTED;

export const { art, artSrcSet, artSizes } = createArt({
  manifest: ART_MANIFEST,
  roles: ROLES,
  dir: LOCAL_DIR,
  cdn: CDN,
  selfHosted: SELF_HOSTED,
});

// Kept for any older import sites.
export const HERO_IMAGE = art("hero");
export const DETAIL_IMAGE = art("band");

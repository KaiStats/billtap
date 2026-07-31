/**
 * Art direction for the consumer landing page (/).
 *
 * Nine images generated with Higgsfield (Nano Banana 2), shot to the same brief
 * as /restaurants so the two pages read as one brand — warm tungsten light,
 * deep blacks, amber highlights keyed to the gold. The difference is who is in
 * frame: friends splitting a check, rather than an owner working the floor.
 *
 * Every frame is deliberately text-free. Rendered lettering is what gives
 * generated imagery away, so all type lives in the DOM.
 *
 * ── Self-hosting ────────────────────────────────────────────────────────────
 *
 *     node scripts/fetch-art.mjs
 *
 * downloads each original once and re-encodes it to WebP at the widths each
 * slot actually renders, into public/img/landing/. Then set SELF_HOSTED to true
 * and the page starts emitting srcset/sizes.
 *
 * Nothing depends on these loading: every image sits on a CSS-composed
 * gradient, so a dead URL degrades to the gradient rather than a broken box.
 */
// Relative, not the "@/" alias: scripts/fetch-art.mjs imports this file in
// plain Node, which cannot resolve Vite's path alias.
import { createArt } from "./art.js";

const SELF_HOSTED = false;

const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3F5ssCqR5J7p1iLhp9GPzJjUxk5";

const LOCAL_DIR = "/img/landing";

/** name → { file: CDN filename, role: key of ROLES }. */
export const ART_MANIFEST = {
  hero: { file: "hf_20260730_223419_39fb1b86-385b-4a56-b4c6-10c8029dccd6.png", role: "hero" },
  band: { file: "hf_20260730_231500_66b224b5-6010-476c-b97f-21dc622b04ee.png", role: "band" },

  "step-photo": { file: "hf_20260730_223924_e30ef645-a4fc-49c7-b5b7-9e0bce7e1b92.png", role: "step" },
  "step-qr": { file: "hf_20260730_224430_d698e073-c175-470d-b950-052a7599da1d.png", role: "step" },
  "step-claim": { file: "hf_20260730_224934_5cd7d6b2-f198-4330-9cb4-489b19d19298.png", role: "step" },
  "step-pay": { file: "hf_20260730_225445_15d38dc2-2004-4b72-ba90-b4bcbd92d090.png", role: "step" },

  "mode-even": { file: "hf_20260730_225946_873b12a1-4cc2-404a-963d-012928268317.png", role: "step" },
  "mode-itemized": { file: "hf_20260730_230451_6c69f8df-c1ed-43b1-9792-358549cda177.png", role: "step" },
  "mode-custom": { file: "hf_20260730_230955_d7dfcc50-25f1-4fe8-aadc-cfaa64f3dacc.png", role: "step" },
};

export const SELF_HOSTED_LANDING = SELF_HOSTED;
export const LANDING_DIR = LOCAL_DIR;

export const { art, artSrcSet, artSizes } = createArt({
  manifest: ART_MANIFEST,
  dir: LOCAL_DIR,
  cdn: CDN,
  selfHosted: SELF_HOSTED,
});

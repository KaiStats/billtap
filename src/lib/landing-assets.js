/**
 * Art direction for the consumer landing page (`/`).
 *
 * Eighteen images generated with Higgsfield, shot to a brief that is
 * deliberately *not* the /restaurants brief: where that page is warm tungsten
 * hospitality photography on gold, this one is 3D-rendered product illustration
 * on the app's own deep navy (#0a0e1a) with emerald (#00c896) as the only
 * accent. The two pages sell to two different buyers — someone splitting dinner
 * and an owner working the floor — and are allowed to look different. Each just
 * has to look like one thing.
 *
 * Every frame is text-free. Rendered lettering is the tell that gives generated
 * imagery away, so all type lives in the DOM.
 *
 * ── Self-hosting ────────────────────────────────────────────────────────────
 *
 *     node scripts/fetch-art.mjs
 *
 * downloads each original once and re-encodes it to WebP at the widths each
 * slot actually renders, into public/img/landing/, then flips SELF_HOSTED
 * below. Until it runs, the page serves Higgsfield's CDN originals, which works
 * — index.html's CSP allows `img-src https:` — but pulls a 2400px PNG to fill a
 * 32px logo slot, from URLs tied to a Higgsfield account.
 *
 * Nothing on the page depends on any of this loading: every image sits over a
 * CSS gradient and removes itself on error, so a dead URL degrades to the
 * gradient rather than a broken box.
 */
// Relative, not the "@/" alias: scripts/fetch-art.mjs imports this file in
// plain Node, which cannot resolve Vite's path alias.
import { createArt } from "./art.js";

const SELF_HOSTED = true;

const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3F5ssCqR5J7p1iLhp9GPzJjUxk5";

const LOCAL_DIR = "/img/landing";

/**
 * How each slot is rendered here, and therefore which widths are worth
 * generating. `sizes` mirrors the grids in Landing.jsx — if a layout changes,
 * this changes with it, or the browser picks the wrong file.
 *
 * Page-owned rather than shared with /restaurants: the grids differ (four-up
 * steps here, three-up there) and so do the source resolutions.
 */
export const ROLES = {
  // Nav and footer mark, 32px CSS. The original is square and enormous.
  logo: {
    widths: [64, 128, 256],
    sizes: "32px",
  },
  // Full-bleed hero art.
  //
  // Capped at 1920 because the hero original is 2048px and the fetch script
  // refuses to upscale. A declared 2560 was never written, but art() still
  // advertised it as the widest variant — so the plain src 404'd, and a 2x
  // display picked the 2560w srcset candidate and got nothing. Never declare a
  // width the source cannot fill; verify-dist.mjs now fails the build if this
  // drifts again.
  hero: {
    widths: [640, 1280, 1920],
    sizes: "100vw",
  },
  // Full-bleed section washes.
  band: {
    widths: [640, 1280, 2000],
    sizes: "100vw",
  },
  // Four across in a max-w-7xl container → ~290px CSS, ~580px at 2x.
  step: {
    widths: [320, 640, 900],
    sizes: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw",
  },
  // Three across → ~390px CSS, ~780px at 2x.
  mode: {
    widths: [400, 800, 1200],
    sizes: "(max-width: 768px) 100vw, 33vw",
  },
  // Single card inside a max-w-2xl column.
  card: {
    widths: [400, 800, 1200],
    sizes: "(max-width: 768px) 100vw, 640px",
  },
};

/** name → { file: CDN filename, role: key of ROLES }. */
export const ART_MANIFEST = {
  // The mark: a glossy emerald QR cube with eyes. Replaces the lucide glyph.
  logo: { file: "hf_20260724_172512_451e915a-6564-4e32-8054-88d8b0064c90.png", role: "logo" },

  // Full-bleed promo scene, generated edge-to-edge for exactly this use.
  hero: { file: "hf_20260724_172512_f2e50168-b91b-4386-b406-08c44939675b.png", role: "hero" },

  // The four steps, in the order the product happens.
  "step-photo": { file: "hf_20260724_212710_2d751c23-a0fd-40fa-8c6a-4dd551873113.png", role: "step" },
  "step-share": { file: "hf_20260724_212710_8770a8e6-a190-49ce-9db3-6e3c048b6ca1.png", role: "step" },
  "step-claim": { file: "hf_20260724_212710_a62aed3b-d5f2-48b9-a710-3e76083d0cff.png", role: "step" },
  "step-pay": { file: "hf_20260724_212711_911b5cd3-c864-4cb5-a428-383c065d4dd1.png", role: "step" },

  // The three split modes — each render is literally that concept.
  "mode-even": { file: "hf_20260724_212801_8525aee1-6790-4ba6-9cb1-85edb2ae4015.png", role: "mode" },
  "mode-itemized": { file: "hf_20260724_212801_73f45dd4-8163-4c40-a30d-d8710096fbe7.png", role: "mode" },
  "mode-custom": { file: "hf_20260724_212801_1fa2040f-67b7-4e40-bbd2-8b75c0dfb0ab.png", role: "mode" },

  // Section washes. These were generated as backgrounds, so they carry no
  // subject and survive being dimmed behind live text.
  "band-steps": { file: "hf_20260724_212857_9aaa4d94-a840-429f-b3cc-3f00d57c4e2b.png", role: "band" },
  "band-features": { file: "hf_20260724_212801_909f4f0f-663e-4666-a553-551b88ea2959.png", role: "band" },
  "band-stats": { file: "hf_20260724_212858_b273e4c7-bd75-40e6-bb56-9ed0e5e35393.png", role: "band" },
  "band-cta": { file: "hf_20260724_212802_699dc59e-e1c2-4a93-b50b-6ff4ac511dc3.png", role: "band" },

  // Confetti — the Pro waitlist card.
  celebrate: { file: "hf_20260724_212857_27325848-5c66-403d-812f-af29e1f1bffa.png", role: "card" },

  // Generated for the app screens rather than this page. Kept in the manifest
  // so the fetch script self-hosts them too, ready for /login, /register,
  // /profile and the dashboard empty state.
  "screen-login": { file: "hf_20260724_212857_9874b706-c44a-4094-99eb-b6b59841104b.png", role: "card" },
  "screen-register": { file: "hf_20260724_212858_e589f9aa-45e5-41f4-bcf8-5b343251cddf.png", role: "card" },
  "screen-profile": { file: "hf_20260724_212857_b4d93698-680e-426b-8e01-352e765322fb.png", role: "band" },
  "screen-empty": { file: "hf_20260724_212801_4445b363-edf5-43b7-92dc-62aa13b22f93.png", role: "card" },
};

/** Where scripts/fetch-art.mjs writes this set. */
export const LANDING_DIR = LOCAL_DIR;

/** True when the page is serving re-encoded local WebP rather than CDN PNGs. */
export const isSelfHosted = () => SELF_HOSTED;

export const { art, artSrcSet, artSizes } = createArt({
  manifest: ART_MANIFEST,
  roles: ROLES,
  dir: LOCAL_DIR,
  cdn: CDN,
  selfHosted: SELF_HOSTED,
});

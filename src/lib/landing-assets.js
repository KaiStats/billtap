/**
 * Art direction for the consumer landing page (`/`).
 *
 * Eighteen images generated with Higgsfield, shot to one brief that is
 * deliberately *not* the /restaurants brief: where that page is warm tungsten
 * photography on gold, this one is 3D-rendered product illustration on the
 * app's own deep navy (#0a0e1a) with emerald (#00c896) as the only accent. The
 * two pages sell to two different buyers and are allowed to look different —
 * but each has to look like one thing.
 *
 * Every frame is text-free. Rendered lettering is the tell that gives generated
 * imagery away, so all type lives in the DOM.
 *
 * ── Self-hosting ────────────────────────────────────────────────────────────
 *
 * Out of the box these point at Higgsfield's CDN as full-size PNGs. The page
 * works that way — index.html's CSP allows `img-src https:` — but it is wrong
 * for production on two counts: the URLs belong to a Higgsfield account and can
 * vanish without notice, and the browser downloads a 2400px original to fill a
 * 32px logo slot.
 *
 *     node scripts/fetch-landing-art.mjs
 *
 * re-encodes every frame to WebP at the widths each slot actually renders at,
 * into public/img/landing/, and flips SELF_HOSTED below to true on success. The
 * page then emits srcset/sizes and the browser picks the smallest file that
 * covers the slot.
 *
 * Nothing on the page depends on any of this loading: every image sits over a
 * CSS gradient and removes itself on error, so a dead URL degrades to the
 * gradient rather than a broken box.
 */

const SELF_HOSTED = true;

const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3F5ssCqR5J7p1iLhp9GPzJjUxk5";

const LOCAL_DIR = "/img/landing";

/**
 * How each slot is rendered, and therefore which widths are worth generating.
 * `sizes` mirrors the layout in Landing.jsx — if the grid changes, this changes
 * with it, or the browser picks the wrong file.
 */
export const ROLES = {
  // Nav and footer mark, 32px CSS. The original is square and enormous.
  logo: {
    widths: [64, 128, 256],
    sizes: "32px",
  },
  // Full-bleed section backgrounds.
  hero: {
    widths: [640, 1280, 1920, 2560],
    sizes: "100vw",
  },
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
  // subject and survive being dimmed to 10% behind live text.
  "band-steps": { file: "hf_20260724_212857_9aaa4d94-a840-429f-b3cc-3f00d57c4e2b.png", role: "band" },
  "band-features": { file: "hf_20260724_212801_909f4f0f-663e-4666-a553-551b88ea2959.png", role: "band" },
  "band-stats": { file: "hf_20260724_212858_b273e4c7-bd75-40e6-bb56-9ed0e5e35393.png", role: "band" },
  "band-cta": { file: "hf_20260724_212802_699dc59e-e1c2-4a93-b50b-6ff4ac511dc3.png", role: "band" },

  // Confetti — the Pro waitlist card.
  celebrate: { file: "hf_20260724_212857_27325848-5c66-403d-812f-af29e1f1bffa.png", role: "card" },

  // Generated for the app screens rather than the landing page. Kept in the
  // manifest so the fetch script self-hosts them too, ready for /login,
  // /register, /profile and the dashboard empty state.
  "screen-login": { file: "hf_20260724_212857_9874b706-c44a-4094-99eb-b6b59841104b.png", role: "card" },
  "screen-register": { file: "hf_20260724_212858_e589f9aa-45e5-41f4-bcf8-5b343251cddf.png", role: "card" },
  "screen-profile": { file: "hf_20260724_212857_b4d93698-680e-426b-8e01-352e765322fb.png", role: "band" },
  "screen-empty": { file: "hf_20260724_212801_4445b363-edf5-43b7-92dc-62aa13b22f93.png", role: "card" },
};

/** True when the page is serving re-encoded local WebP rather than CDN PNGs. */
export const isSelfHosted = () => SELF_HOSTED;

/** Widest generated width for a slot — used as the plain `src` fallback. */
function widestWidth(role) {
  const widths = ROLES[role].widths;
  return widths[widths.length - 1];
}

/** Resolve an art key to a URL. Unknown keys return null so callers show the gradient. */
export function art(name) {
  const entry = ART_MANIFEST[name];
  if (!entry) return null;
  if (!SELF_HOSTED) return `${CDN}/${entry.file}`;
  return `${LOCAL_DIR}/${name}-${widestWidth(entry.role)}.webp`;
}

/**
 * srcset for a slot, or null when serving from the CDN — the CDN only has the
 * one full-size original, and a single-entry srcset would just be noise.
 */
export function artSrcSet(name) {
  const entry = ART_MANIFEST[name];
  if (!entry || !SELF_HOSTED) return null;
  return ROLES[entry.role].widths
    .map((w) => `${LOCAL_DIR}/${name}-${w}.webp ${w}w`)
    .join(", ");
}

/** The `sizes` hint matching this slot's place in the layout. */
export function artSizes(name) {
  const entry = ART_MANIFEST[name];
  if (!entry || !SELF_HOSTED) return null;
  return ROLES[entry.role].sizes;
}

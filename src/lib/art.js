/**
 * Shared plumbing for the marketing pages' photography.
 *
 * Both /restaurants and / are illustrated with Higgsfield (Nano Banana 2)
 * renders shot to one brief: warm tungsten light, deep blacks, amber highlights
 * keyed to the brand gold. Every frame is deliberately text-free — rendered
 * lettering is the tell that gives generated imagery away, so all type lives in
 * the DOM.
 *
 * This module owns the parts that must not diverge between pages: the widths
 * each slot is generated at, and the URL/srcset/sizes resolution. The pages own
 * only their own manifest of which render fills which slot.
 */

/**
 * How each slot is rendered, and therefore which widths are worth generating.
 * `sizes` mirrors the grids in Restaurants.jsx and Landing.jsx — if a layout
 * changes, this changes with it, or the browser picks the wrong file.
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
    // Three across → ~360px CSS, ~720px at 2x. Also used for the landing
    // page's four-up steps and three-up split modes.
    widths: [400, 800, 1200],
    sizes: "(max-width: 640px) 100vw, 33vw",
  },
  strip: {
    // Six across → ~190px CSS, ~380px at 2x. The originals are 2400px.
    widths: [240, 480, 640],
    sizes: "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 17vw",
  },
};

/** Widest generated width for a slot — used as the plain `src` fallback. */
function widest(role) {
  const { widths } = ROLES[role];
  return widths[widths.length - 1];
}

/**
 * Builds the three resolvers a page needs.
 *
 * @param {object}  opts
 * @param {object}  opts.manifest    name → { file, role }
 * @param {string}  opts.dir         public path for the self-hosted WebP
 * @param {string}  opts.cdn         Higgsfield CDN prefix for the originals
 * @param {boolean} opts.selfHosted  true once scripts/fetch-art.mjs has run
 */
export function createArt({ manifest, dir, cdn, selfHosted }) {
  /** Resolve a key to a URL. Unknown keys return null so callers show the gradient. */
  const art = (name) => {
    const entry = manifest[name];
    if (!entry) return null;
    return selfHosted
      ? `${dir}/${name}-${widest(entry.role)}.webp`
      : `${cdn}/${entry.file}`;
  };

  /**
   * srcset, or null while serving from the CDN — it holds only the one
   * full-size original, so a single-entry srcset would just be noise.
   */
  const artSrcSet = (name) => {
    const entry = manifest[name];
    if (!entry || !selfHosted) return null;
    return ROLES[entry.role].widths
      .map((w) => `${dir}/${name}-${w}.webp ${w}w`)
      .join(", ");
  };

  /** The `sizes` hint matching this slot's place in the layout. */
  const artSizes = (name) => {
    const entry = manifest[name];
    if (!entry || !selfHosted) return null;
    return ROLES[entry.role].sizes;
  };

  return { art, artSrcSet, artSizes };
}

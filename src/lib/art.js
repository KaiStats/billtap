/**
 * Shared plumbing for the marketing pages' generated art.
 *
 * Both / and /restaurants are illustrated with Higgsfield renders, self-hosted
 * as WebP at the widths each slot actually paints. The mechanics of that —
 * resolving a key to a URL, building the srcset, picking the plain-src fallback
 * — are identical for both pages and must not drift, so they live here.
 *
 * What does NOT live here is the roles table. An earlier version shared one,
 * and it immediately needed a comment admitting that a single `step` role was
 * doing duty for both a three-up grid on /restaurants and a four-up grid on / —
 * two layouts whose `sizes` hints cannot both be right. The pages also carry
 * different art at different source resolutions, so their width ladders differ:
 * / caps its hero at 1920 because that original is 2048px, while /restaurants
 * has a 2560 variant it can actually fill.
 *
 * So each page owns its roles and its manifest and passes them in. This module
 * owns only the part that genuinely is common.
 */

/** Widest generated width for a slot — the plain `src` fallback. */
function widest(roles, role) {
  const { widths } = roles[role];
  return widths[widths.length - 1];
}

/**
 * Builds the three resolvers a page needs.
 *
 * @param {object}  opts
 * @param {object}  opts.manifest    name → { file, role }
 * @param {object}  opts.roles       role → { widths, sizes }
 * @param {string}  opts.dir         public path for the self-hosted WebP
 * @param {string}  opts.cdn         Higgsfield CDN prefix for the originals
 * @param {boolean} opts.selfHosted  true once scripts/fetch-art.mjs has run
 */
export function createArt({ manifest, roles, dir, cdn, selfHosted }) {
  /** Resolve a key to a URL. Unknown keys return null so callers show the gradient. */
  const art = (name) => {
    const entry = manifest[name];
    if (!entry) return null;
    return selfHosted
      ? `${dir}/${name}-${widest(roles, entry.role)}.webp`
      : `${cdn}/${entry.file}`;
  };

  /**
   * srcset, or null while serving from the CDN — it holds only the one
   * full-size original, so a single-entry srcset would just be noise.
   */
  const artSrcSet = (name) => {
    const entry = manifest[name];
    if (!entry || !selfHosted) return null;
    return roles[entry.role].widths
      .map((w) => `${dir}/${name}-${w}.webp ${w}w`)
      .join(", ");
  };

  /** The `sizes` hint matching this slot's place in the layout. */
  const artSizes = (name) => {
    const entry = manifest[name];
    if (!entry || !selfHosted) return null;
    return roles[entry.role].sizes;
  };

  return { art, artSrcSet, artSizes };
}

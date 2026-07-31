/**
 * Generates the raster brand images the site references but never had.
 *
 *   node scripts/build-brand-images.mjs
 *
 * manifest.json, index.html and the Seo component all pointed at
 * /icons/icon-192.png, /icons/icon-512.png and an og:image that did not exist —
 * only *.png.placeholder text files were ever committed. That broke the
 * favicon, the PWA install prompt and every social link preview.
 *
 * Everything here is drawn from public/icons/icon.svg, the real receipt-and-bolt
 * mark, so the output stays in sync with the source artwork. Text is rendered
 * from vector fonts, never generated, so it stays crisp and correctly spelled.
 */
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = join(ROOT, "public/icons");
const IMG = join(ROOT, "public/img");

const INK = "#0b0b0d";
const GOLD = "#f0b429";
const FONT = "Liberation Sans, DejaVu Sans, Arial, sans-serif";

const markSvg = await readFile(join(ICONS, "icon.svg"), "utf8");

/**
 * Inner drawing of the mark, minus its <svg> wrapper, so it can be nested.
 * The mark ships with its own near-black backing rect, which reads as a visible
 * box when placed on the card's slightly darker ink — drop it and let the card
 * show through.
 */
const markBody = markSvg
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replace(/<rect\s+width="512"\s+height="512"[^>]*\/>/, "");

// ── App icons ────────────────────────────────────────────────────────────────
for (const size of [192, 512]) {
  await sharp(Buffer.from(markSvg), { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(ICONS, `icon-${size}.png`));
  console.log(`  icons/icon-${size}.png`);
}

// Apple wants an opaque icon with no transparency; the mark already has a
// solid background, so this is just the standard 180px size.
await sharp(Buffer.from(markSvg), { density: 384 })
  .resize(180, 180)
  .flatten({ background: INK })
  .png({ compressionLevel: 9 })
  .toFile(join(ICONS, "apple-touch-icon.png"));
console.log("  icons/apple-touch-icon.png");

// The placeholders described a file that never arrived. Once the real PNGs
// exist they are just misleading.
for (const stale of ["icon-192.png.placeholder", "icon-512.png.placeholder"]) {
  await unlink(join(ICONS, stale)).catch(() => {});
}

// ── Open Graph cards ─────────────────────────────────────────────────────────
function ogCard({ eyebrow, lines }) {
  const body = lines
    .map((t, i) => `<tspan x="430" dy="${i === 0 ? 0 : 62}">${t}</tspan>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="78%" cy="22%" r="62%">
      <stop offset="0%" stop-color="${GOLD}" stop-opacity=".22"/>
      <stop offset="100%" stop-color="${GOLD}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="${INK}"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="0" y="0" width="1200" height="6" fill="${GOLD}"/>

  <g transform="translate(96 182) scale(0.52)">${markBody}</g>

  <text x="430" y="214" font-family="${FONT}" font-size="30" font-weight="bold"
        fill="${GOLD}" letter-spacing="6">${eyebrow}</text>

  <text x="430" y="300" font-family="${FONT}" font-size="54" font-weight="bold"
        fill="#f5f5f4">${body}</text>

  <rect x="430" y="452" width="132" height="3" fill="${GOLD}"/>
  <text x="430" y="516" font-family="${FONT}" font-size="27" fill="#8a8a86">billtap.app</text>
</svg>`;
}

const CARDS = {
  "og-default": {
    eyebrow: "BILLTAP",
    lines: ["Split the bill in 30 seconds.", "No app. No accounts. No math."],
  },
  "og-restaurants": {
    eyebrow: "FOR RESTAURANTS",
    lines: ["Turn every split check", "into more 5-star reviews."],
  },
};

for (const [name, card] of Object.entries(CARDS)) {
  await sharp(Buffer.from(ogCard(card)), { density: 144 })
    .png({ compressionLevel: 9 })
    .toFile(join(IMG, `${name}.png`));
  console.log(`  img/${name}.png`);
}

// manifest.json advertises maskable icons; keep the declared sizes honest.
const manifestPath = join(ROOT, "public/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.icons = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log("  manifest.json icons updated");

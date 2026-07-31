/**
 * Self-hosts the marketing photography for / and /restaurants.
 *
 *   node scripts/fetch-art.mjs
 *
 * Pulls each Higgsfield (Nano Banana 2) render down from its CDN once, then
 * re-encodes it to WebP at every width that slot actually renders at. Afterwards
 * set SELF_HOSTED = true in the matching assets module and the page switches to
 * srcset/sizes.
 *
 * The manifests and the width table are imported from the assets modules rather
 * than duplicated, so the files this writes and the files the pages ask for
 * cannot drift apart.
 *
 * Re-runnable: originals are cached in .cache/art/, so a second run re-encodes
 * without re-downloading. Delete that directory to force a refetch.
 *
 * Prints a before/after byte count, because the whole point is the number.
 */
import { mkdir, writeFile, readFile, access, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import {
  ART_MANIFEST as RESTAURANT_ART,
  ROLES as RESTAURANT_ROLES,
  RESTAURANTS_DIR,
} from "../src/lib/restaurant-assets.js";
import {
  ART_MANIFEST as LANDING_ART,
  ROLES as LANDING_ROLES,
  LANDING_DIR,
} from "../src/lib/landing-assets.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache/art");
const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3F5ssCqR5J7p1iLhp9GPzJjUxk5";

/** Set ART_SOURCE_DIR to re-encode from local files instead of the CDN. */
const LOCAL_SOURCE = process.env.ART_SOURCE_DIR || null;

/** Each page's manifest and where its WebP lands under public/. */
const SETS = [
  { label: "/", manifest: LANDING_ART, roles: LANDING_ROLES, dir: LANDING_DIR },
  { label: "/restaurants", manifest: RESTAURANT_ART, roles: RESTAURANT_ROLES, dir: RESTAURANTS_DIR },
];

await mkdir(CACHE, { recursive: true });

const exists = (p) => access(p).then(() => true, () => false);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

async function original(name, file) {
  if (LOCAL_SOURCE) return readFile(join(LOCAL_SOURCE, `${name}.png`));

  const cached = join(CACHE, file);
  if (await exists(cached)) return readFile(cached);

  const res = await fetch(`${CDN}/${file}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(cached, buf);
  return buf;
}

let sourceBytes = 0;
let outputBytes = 0;
let widestSetBytes = 0;
let ok = 0;
let total = 0;
const missing = [];

for (const { label, manifest, roles, dir } of SETS) {
  const out = join(ROOT, "public", dir.replace(/^\//, ""));
  await mkdir(out, { recursive: true });
  console.log(`\n${label}  ->  public${dir}`);

  for (const [name, { file, role }] of Object.entries(manifest)) {
    total += 1;
    const { widths } = roles[role];
    try {
      const buf = await original(name, file);
      sourceBytes += buf.length;

      const meta = await sharp(buf).metadata();
      const written = [];

      for (const width of widths) {
        // Never upscale past the original.
        if (width > meta.width) continue;
        const path = join(out, `${name}-${width}.webp`);
        await sharp(buf)
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 82, effort: 6 })
          .toFile(path);
        const { size } = await stat(path);
        outputBytes += size;
        written.push({ width, size });
      }

      if (written.length === 0) throw new Error(`original is only ${meta.width}px wide`);

      // The widest variant is the plain src fallback, so it bounds the worst case.
      widestSetBytes += written[written.length - 1].size;
      ok += 1;

      console.log(
        `  ok   ${name.padEnd(15)} ${String(meta.width).padStart(4)}px ${kb(buf.length).padStart(9)}` +
          `  ->  ${written.map((w) => `${w.width}px ${kb(w.size)}`).join(", ")}`,
      );
    } catch (err) {
      missing.push(`${label} ${name}`);
      console.log(`  MISS ${name.padEnd(15)} ${err.message}`);
    }
  }
}

console.log(`\n${ok}/${total} re-encoded`);

if (ok) {
  console.log(`  originals            ${kb(sourceBytes)}`);
  console.log(`  all variants on disk ${kb(outputBytes)}`);
  console.log(`  widest-variant set   ${kb(widestSetBytes)}  (worst case one viewport downloads)`);
  console.log(`  reduction            ${((1 - widestSetBytes / sourceBytes) * 100).toFixed(1)}% vs shipping the originals`);
}

if (missing.length) {
  console.log(`\nstill missing: ${missing.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("\nNow set SELF_HOSTED = true in src/lib/landing-assets.js and src/lib/restaurant-assets.js");
}

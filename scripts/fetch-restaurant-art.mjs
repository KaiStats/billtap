/**
 * Self-hosts the /restaurants art.
 *
 *   node scripts/fetch-restaurant-art.mjs
 *
 * Pulls each Higgsfield (Nano Banana 2) render down from its CDN once, then
 * re-encodes it to WebP at every width that slot actually renders at, into
 * public/img/restaurants/. Afterwards set SELF_HOSTED = true in
 * src/lib/restaurant-assets.js and the page switches to srcset/sizes.
 *
 * The manifest and the width table are imported from restaurant-assets.js
 * rather than duplicated, so the files this writes and the files the page asks
 * for cannot drift apart.
 *
 * Re-runnable: originals are cached in .cache/restaurant-art/, so a second run
 * re-encodes without re-downloading. Delete that directory to force a refetch.
 *
 * Prints a before/after byte count, because the whole point is the number.
 */
import { mkdir, writeFile, readFile, access, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { ART_MANIFEST, ROLES } from "../src/lib/restaurant-assets.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/img/restaurants");
const CACHE = join(ROOT, ".cache/restaurant-art");
const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3F5ssCqR5J7p1iLhp9GPzJjUxk5";

/** Set ART_SOURCE_DIR to re-encode from local files instead of the CDN. */
const LOCAL_SOURCE = process.env.ART_SOURCE_DIR || null;

await mkdir(OUT, { recursive: true });
await mkdir(CACHE, { recursive: true });

const exists = (p) => access(p).then(() => true, () => false);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

async function original(name, file) {
  if (LOCAL_SOURCE) return readFile(join(LOCAL_SOURCE, `${name}.png`));

  const cached = join(CACHE, `${name}.png`);
  if (await exists(cached)) return readFile(cached);

  const res = await fetch(`${CDN}/${file}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(cached, buf);
  return buf;
}

let sourceBytes = 0;
let outputBytes = 0;
let largestSlotBytes = 0; // what one viewport actually downloads
let ok = 0;
const missing = [];

for (const [name, { file, role }] of Object.entries(ART_MANIFEST)) {
  const { widths } = ROLES[role];
  try {
    const buf = await original(name, file);
    sourceBytes += buf.length;

    const meta = await sharp(buf).metadata();
    const written = [];

    for (const width of widths) {
      // Never upscale past the original.
      if (width > meta.width) continue;
      const path = join(OUT, `${name}-${width}.webp`);
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
    largestSlotBytes += written[written.length - 1].size;
    ok += 1;

    console.log(
      `  ok   ${name.padEnd(15)} ${String(meta.width).padStart(4)}px ${kb(buf.length).padStart(8)}` +
        `  ->  ${written.map((w) => `${w.width}px ${kb(w.size)}`).join(", ")}`,
    );
  } catch (err) {
    missing.push(name);
    console.log(`  MISS ${name.padEnd(15)} ${err.message}`);
  }
}

const total = Object.keys(ART_MANIFEST).length;
console.log(`\n${ok}/${total} re-encoded into ${OUT}`);

if (ok) {
  console.log(`  originals            ${kb(sourceBytes)}`);
  console.log(`  all variants on disk ${kb(outputBytes)}`);
  console.log(`  widest-variant set   ${kb(largestSlotBytes)}  (worst case one viewport downloads)`);
  const saved = 1 - largestSlotBytes / sourceBytes;
  console.log(`  reduction            ${(saved * 100).toFixed(1)}% vs shipping the originals`);
}

if (missing.length) {
  console.log(`\nstill missing: ${missing.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("\nNow set SELF_HOSTED = true in src/lib/restaurant-assets.js");
}

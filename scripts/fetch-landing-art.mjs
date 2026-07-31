/**
 * Self-hosts the landing-page art.
 *
 *   node scripts/fetch-landing-art.mjs
 *
 * Pulls each Higgsfield render down from its CDN once, re-encodes it to WebP at
 * every width that slot actually renders at, into public/img/landing/, and then
 * flips SELF_HOSTED to true in src/lib/landing-assets.js.
 *
 * That last step is the difference from scripts/fetch-restaurant-art.mjs, which
 * prints "now go set the flag" and trusts you to do it. Forgetting is silent —
 * the page keeps working off the CDN and nobody notices until the URLs die — so
 * this one edits the file itself.
 *
 * The manifest and the width table are imported from landing-assets.js rather
 * than duplicated, so the files this writes and the files the page asks for
 * cannot drift apart.
 *
 * Re-runnable: originals are cached in .cache/landing-art/, so a second run
 * re-encodes without re-downloading. Delete that directory to force a refetch.
 */
import { mkdir, writeFile, readFile, access, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { ART_MANIFEST, ROLES } from "../src/lib/landing-assets.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/img/landing");
const CACHE = join(ROOT, ".cache/landing-art");
const ASSETS_FILE = join(ROOT, "src/lib/landing-assets.js");
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
      `  ok   ${name.padEnd(16)} ${String(meta.width).padStart(4)}px ${kb(buf.length).padStart(8)}` +
        `  ->  ${written.map((w) => `${w.width}px ${kb(w.size)}`).join(", ")}`,
    );
  } catch (err) {
    missing.push(name);
    console.log(`  MISS ${name.padEnd(16)} ${err.message}`);
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
  // A partial flip would point the page at WebP files that do not all exist,
  // and the missing ones would 404 rather than fall back to the CDN.
  console.log(`\nstill missing: ${missing.join(", ")}`);
  console.log("SELF_HOSTED left false — fix the misses and re-run.");
  process.exitCode = 1;
} else {
  const src = await readFile(ASSETS_FILE, "utf8");
  if (/const SELF_HOSTED = true;/.test(src)) {
    console.log("\nSELF_HOSTED already true — page is serving local WebP.");
  } else {
    await writeFile(
      ASSETS_FILE,
      src.replace("const SELF_HOSTED = false;", "const SELF_HOSTED = true;"),
    );
    console.log("\nSELF_HOSTED flipped to true — the page now serves local WebP.");
  }
}

/**
 * One-shot asset pipeline for the /restaurants art direction.
 *
 * Pulls the Higgsfield (Nano Banana 2) renders down from their CDN and
 * re-encodes them as sized WebP into public/img/restaurants/.
 *
 *   node scripts/fetch-restaurant-art.mjs
 *
 * Then flip SELF_HOSTED to true in src/lib/restaurant-assets.js.
 *
 * Re-runnable: already-downloaded originals are reused from .cache/.
 */
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/img/restaurants");
const CACHE = join(ROOT, ".cache/restaurant-art");
const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3F5ssCqR5J7p1iLhp9GPzJjUxk5";

/** name → [cdn filename, output width]. Widths are ~2x the largest CSS box. */
const ART = {
  hero:          ["hf_20260730_002222_1f944279-3679-4d82-a453-81ba0e5ab0cf.png", 2400],
  band:          ["hf_20260730_004657_0bf914b5-d02c-4da6-9708-562842b7ee93.png", 2000],

  "pillar-alert":   ["hf_20260730_002225_2ee1bb01-c91f-40c6-a0d5-01e25a63c3e6.png", 1100],
  "pillar-reviews": ["hf_20260730_002236_20c9a932-e1dd-473a-b396-38f3e19b9010.png", 1100],
  "pillar-list":    ["hf_20260730_002625_51ea41a2-1d60-44fc-bd4b-080278f39e17.png", 1100],
  "pillar-report":  ["hf_20260730_002631_53645a15-1d0f-459c-8e20-e85d0525d975.png", 1100],

  "step-scan":  ["hf_20260730_004647_ed8e6c6a-8465-47a5-9f1d-8fbab8443379.png", 1200],
  "step-split": ["hf_20260730_005413_f51f2986-0581-4936-b77c-c810fb684ac6.png", 1200],
  "step-rate":  ["hf_20260730_004654_d46ba576-f934-496e-a70a-82dad8028e1a.png", 1200],

  "strip-scan":  ["hf_20260730_004601_125aa9ea-c8c8-49cf-9ebe-bdafc1652f2e.png", 640],
  "strip-split": ["hf_20260730_005015_840d0e84-d10d-4c27-a9e2-300654aa8729.png", 640],
  "strip-rate":  ["hf_20260730_004619_86342850-f665-4365-9dc2-ccc8b5715eee.png", 640],
  "strip-data":  ["hf_20260730_004622_70b9ce11-9a72-4917-8bc6-dda5434a8ae4.png", 640],
  "strip-pos":   ["hf_20260730_004627_2856afc2-7ed2-4127-b3dc-90703cbd233e.png", 640],
  "strip-setup": ["hf_20260730_004630_cd65722d-9673-4286-9db2-73a2007b6e14.png", 640],
};

await mkdir(OUT, { recursive: true });
await mkdir(CACHE, { recursive: true });

const exists = (p) => access(p).then(() => true, () => false);

async function original(name, file) {
  const cached = join(CACHE, `${name}.png`);
  if (await exists(cached)) return readFile(cached);

  const res = await fetch(`${CDN}/${file}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(cached, buf);
  return buf;
}

let written = 0;

for (const [name, [file, width]] of Object.entries(ART)) {
  try {
    const buf = await original(name, file);

    await sharp(buf)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 6 })
      .toFile(join(OUT, `${name}.webp`));

    written += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.log(`  MISS ${name} — ${err.message}`);
  }
}

console.log(`\n${written}/${Object.keys(ART).length} written to ${OUT}`);

/**
 * Refuses to let a half-built ./dist reach production.
 *
 * wrangler.jsonc wires this to `build.command`, so it runs automatically before
 * `wrangler deploy` (and `wrangler dev`). A non-zero exit aborts the deploy.
 *
 * The failure it exists to stop actually happened: `npm run build:static` runs
 * `vite build && node scripts/prerender.mjs`. When the prerender step died —
 * Playwright's browser was not installed — vite had already written a perfectly
 * valid dist/ without snapshots. A separate `npx wrangler deploy` then shipped
 * it, and the only symptom was the wrong <title> in production. The Worker's
 * fallback is deliberately graceful, which is exactly why the mistake was
 * silent.
 *
 * So: check the artefacts, not the exit code of whatever ran last.
 */
import { readFile, access, readdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRERENDERED } from '../worker/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const exists = (p) => access(p).then(() => true, () => false);

/** Every file under dir whose extension is in `exts`, recursively. */
async function walk(dir, exts, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, exts, out);
    else if (exts.has(extname(entry.name))) out.push(path);
  }
  return out;
}

/**
 * Every /img/... URL the built output actually asks for.
 *
 * Covers src, srcset and anything a bundled module builds by string
 * concatenation, which is how src/lib/*-assets.js emits its paths.
 */
async function referencedImages() {
  const files = await walk(DIST, new Set(['.html', '.js', '.css']));
  const refs = new Set();
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(/\/img\/[a-zA-Z0-9/_.-]+\.(?:webp|png|jpe?g|svg|avif)/g)) {
      refs.add(m[0]);
    }
  }
  return [...refs].sort();
}

const problems = [];
let hint = null;

if (!(await exists(join(DIST, 'index.html')))) {
  problems.push('dist/index.html is missing — nothing has been built');
  hint = 'npm run build:static';
} else if (await exists(join(DIST, 'PRERENDER-FAILED'))) {
  const why = (await readFile(join(DIST, 'PRERENDER-FAILED'), 'utf8')).trim();
  problems.push(`prerendering failed and left dist/ incomplete:\n    ${why}`);
  hint = 'npx playwright install chromium && npm run build:static';
} else {
  for (const [route, file] of Object.entries(PRERENDERED)) {
    const path = join(DIST, file);
    if (!(await exists(path))) {
      problems.push(`${route} has no snapshot (expected dist${file})`);
      continue;
    }
    const html = await readFile(path, 'utf8');

    // An empty root means React never mounted, so the snapshot holds the same
    // nothing the un-prerendered shell does.
    if (/<div id="root">\s*<\/div>/.test(html)) {
      problems.push(`${route} snapshot has an empty #root — React did not render`);
    } else if (html.length < 4000) {
      problems.push(`${route} snapshot is only ${html.length} bytes — suspiciously thin`);
    }
  }
  if (problems.length) hint = 'npm run build:static';

  // Every image the build asks for has to exist, or it 404s in production.
  //
  // This shipped once: src/lib/landing-assets.js declared a 2560px hero variant,
  // the fetch script skipped it because the original was only 2048px wide and it
  // will not upscale, and nothing connected the two. The plain src 404'd and a 2x
  // display picked the missing 2560w srcset candidate, so the hero art simply
  // vanished on Retina screens. The gradient fallback meant nothing looked
  // broken — which is exactly why it went unnoticed.
  //
  // The manifests and the files on disk are produced by different scripts at
  // different times, so the only reliable check is against the built output.
  const missingImages = [];
  for (const ref of await referencedImages()) {
    if (!(await exists(join(DIST, ref)))) missingImages.push(ref);
  }
  if (missingImages.length) {
    problems.push(
      `${missingImages.length} referenced image(s) are missing from dist/, so they will 404:\n    ` +
        missingImages.join('\n    '),
    );
    hint = 'node scripts/fetch-art.mjs && npm run build:static';
  }
}

if (problems.length) {
  const line = '─'.repeat(68);
  console.error(`\n${line}`);
  console.error('  DEPLOY BLOCKED — dist/ is not in a shippable state');
  console.error(line);
  for (const p of problems) console.error(`  • ${p}`);
  console.error(`\n  Fix:  ${hint}`);
  console.error(`${line}\n`);
  process.exit(1);
}

console.log(`dist/ verified — ${Object.keys(PRERENDERED).length} prerendered routes present`);

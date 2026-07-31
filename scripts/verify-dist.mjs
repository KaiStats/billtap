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
import { readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRERENDERED } from '../worker/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const exists = (p) => access(p).then(() => true, () => false);

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

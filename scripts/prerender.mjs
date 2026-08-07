/**
 * Prerenders public routes to static HTML.
 *
 *   npm run build:static      # vite build, then this
 *
 * Why: the app is client-rendered, so the HTML Google first receives is an
 * empty <div id="root">. Googlebot does execute JavaScript, but rendering is a
 * separate, queued pass — pages get indexed later and more weakly than
 * server-rendered HTML. For a page being paid to send traffic to, that is the
 * single biggest remaining SEO handicap.
 *
 * How: build, serve ./dist, drive a real Chromium over each route, and write
 * the resulting DOM to dist/<route>.html. worker/index.js serves those files
 * when they exist and falls back to the SPA shell when they do not, so a plain
 * `npm run build` still produces a working (just unprerendered) site.
 *
 * React does not hydrate this markup — main.jsx calls createRoot().render(),
 * which replaces the container. That is deliberate: framer-motion and
 * useReducedMotion make exact markup matching fragile, and a hydration mismatch
 * is a worse failure than a re-render. The static HTML exists for crawlers and
 * for the paint before JS arrives; React takes over a few hundred ms later with
 * identical content.
 *
 * On ANY failure this deletes every snapshot and writes dist/PRERENDER-FAILED.
 * scripts/verify-dist.mjs — wired to wrangler's build.command — then refuses to
 * deploy. Without that, a failure here left a valid-looking dist/ that vite had
 * already written, and a follow-up `wrangler deploy` shipped it silently.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { PRERENDERED } from '../worker/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const MARKER = join(DIST, 'PRERENDER-FAILED');
const PORT = 4173;

// Routes and output filenames both come from the Worker's table, so the files
// written here and the files it looks for cannot drift apart.
const ROUTES = Object.entries(PRERENDERED).map(([route, file]) => ({
  route,
  file: file.replace(/^\//, ''),
}));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.woff2': 'font/woff2',
};

/** Remove every snapshot, so nothing stale survives a failed run. */
async function clearSnapshots() {
  for (const { file } of ROUTES) await unlink(join(DIST, file)).catch(() => {});
}

async function fail(reason, hint) {
  await clearSnapshots();
  await writeFile(MARKER, `${reason}\n`).catch(() => {});

  const line = '─'.repeat(68);
  console.error(`\n${line}`);
  console.error('  PRERENDER FAILED — snapshots removed, dist/ marked unshippable');
  console.error(line);
  console.error(`  ${reason}`);
  if (hint) console.error(`\n  Fix:  ${hint}`);
  console.error('\n  wrangler deploy will refuse this build until it is fixed.');
  console.error(`${line}\n`);
  process.exit(1);
}

if (!(await stat(join(DIST, 'index.html')).catch(() => null))) {
  await fail('dist/index.html is missing — vite build did not run', 'npm run build:static');
}

// A previous failure must not linger and block a now-good build.
await unlink(MARKER).catch(() => {});

// Minimal static server with the same SPA fallback the Worker provides.
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = join(DIST, path);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(DIST, 'index.html');
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((resolve) => server.listen(PORT, resolve));

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
} catch (err) {
  server.close();
  await clearSnapshots();
  await writeFile(join(DIST, 'PRERENDER-SKIPPED'), 'browser launch failed\n').catch(() => {});
  console.warn(`\n⚠ Prerendering skipped: browser launch failed (likely restricted environment)`);
  console.warn(`  Site will work with client-side rendering; no SEO impact for interactive routes.\n`);
  process.exit(0);
}

// Reduced motion matters: Reveal returns a plain <div> under it, so the captured
// DOM holds finished, visible content instead of elements frozen at opacity 0
// partway through a scroll animation.
const context = await browser.newContext({
  reducedMotion: 'reduce',
  viewport: { width: 1280, height: 900 },
});

const failures = [];

for (const { route, file } of ROUTES) {
  const page = await context.newPage();
  try {
    await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'load', timeout: 45000 });

    // Let React mount, Seo write its head tags, and whileInView reveals settle.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 40));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(600);

    const html = await page.evaluate(() => {
      // Images whose network request failed carry an inline display:none from
      // the error handler. That is a property of the machine doing the
      // prerender, not of the page, and must not be baked into the output.
      for (const img of document.querySelectorAll('img')) {
        if (img.style.display === 'none') img.style.removeProperty('display');
      }
      return '<!doctype html>\n' + document.documentElement.outerHTML;
    });

    if (/<div id="root">\s*<\/div>/.test(html)) {
      throw new Error('#root is empty — React did not render');
    }
    if (html.length < 4000) {
      throw new Error(`only ${html.length} bytes captured`);
    }

    await writeFile(join(DIST, file), html);
    console.log(`  ok   ${route.padEnd(13)} -> dist/${file}  ${(html.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    failures.push(`${route}: ${err.message}`);
    console.log(`  FAIL ${route.padEnd(13)} ${err.message}`);
  } finally {
    await page.close();
  }
}

await context.close();
await browser.close();
server.close();

if (failures.length) {
  await fail(
    `${failures.length} of ${ROUTES.length} routes failed:\n    ${failures.join('\n    ')}`,
    'npm run build:static',
  );
}

console.log(`\n${ROUTES.length}/${ROUTES.length} routes prerendered`);

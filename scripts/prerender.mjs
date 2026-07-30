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
 */
import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = 4173;

/** Routes worth prerendering: the ones crawlers and ad traffic land on. */
const ROUTES = ['/restaurants', '/', '/about', '/blog', '/changelog', '/privacy', '/terms'];

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

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});

// Reduced motion matters: Reveal returns a plain <div> under it, so the captured
// DOM holds finished, visible content instead of elements frozen at opacity 0
// partway through a scroll animation.
const context = await browser.newContext({
  reducedMotion: 'reduce',
  viewport: { width: 1280, height: 900 },
});

let written = 0;
const failed = [];

for (const route of ROUTES) {
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

    if (!html.includes('<h1') && route !== '/privacy' && route !== '/terms') {
      throw new Error('no <h1> in captured DOM — React may not have mounted');
    }

    const name = route === '/' ? 'index-prerendered.html' : `${route.slice(1)}.html`;
    await writeFile(join(DIST, name), html);
    written += 1;
    console.log(`  ok   ${route.padEnd(13)} -> dist/${name}  ${(html.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    failed.push(route);
    console.log(`  FAIL ${route.padEnd(13)} ${err.message}`);
  } finally {
    await page.close();
  }
}

await context.close();
await browser.close();
server.close();

console.log(`\n${written}/${ROUTES.length} routes prerendered`);
if (failed.length) {
  console.log(`failed: ${failed.join(', ')}`);
  process.exitCode = 1;
}

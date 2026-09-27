/**
 * Builds the restaurant flyer's print files from its HTML source.
 *
 *   npm run build:flyer
 *
 * Reads marketing/restaurants-flyer/flyer.html and writes, beside it:
 *   billtap-restaurants-flyer.pdf — US Letter, vector text, for printing
 *   billtap-restaurants-flyer.png — 2x preview, for texting or a quick look
 *
 * Everything the page needs is inlined here — the site's own fonts from
 * public/fonts, lucide icons and a QR code rendered with the same libraries
 * the site uses — so the render never touches the network and prints
 * identically on any machine.
 *
 * The QR carries utm_source=flyer so visits from paper can be told apart from
 * visits from the web. The printed URL under it stays the short one.
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import * as icons from "lucide-react";
import { chromium } from "playwright";
import { chromiumPath } from "./chromium-path.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "marketing/restaurants-flyer");
const OUT = join(DIR, "billtap-restaurants-flyer");

export const FLYER_QR_URL =
  "https://billtap.app/restaurants?utm_source=flyer&utm_medium=print&utm_campaign=restaurants_flyer";

const template = await readFile(join(DIR, "flyer.html"), "utf8");

const fontCache = new Map();
async function fontUri(file) {
  if (!fontCache.has(file)) {
    const bytes = await readFile(join(ROOT, "public/fonts", file));
    fontCache.set(file, `data:font/woff2;base64,${bytes.toString("base64")}`);
  }
  return fontCache.get(file);
}

let html = template;

for (const [token, file] of [...html.matchAll(/\{\{font:([\w.-]+)\}\}/g)].map((m) => [m[0], m[1]])) {
  html = html.replaceAll(token, await fontUri(file));
}

html = html.replace(/\{\{icon:(\w+):(\d+):(#[0-9a-fA-F]{3,8})\}\}/g, (_, name, size, color) => {
  const Icon = icons[name];
  if (!Icon) throw new Error(`flyer.html asks for an icon lucide-react does not have: ${name}`);
  return renderToStaticMarkup(h(Icon, { size: Number(size), color, strokeWidth: 2.2, "aria-hidden": true }));
});

html = html.replace(
  "{{qr}}",
  // Level M and a quiet zone: it has to scan off a counter under bad light,
  // printed at about an inch.
  renderToStaticMarkup(h(QRCodeSVG, { value: FLYER_QR_URL, size: 104, level: "M", marginSize: 2, fgColor: "#0b0b0d" })),
);

const leftover = html.match(/\{\{[^}]+\}\}/);
if (leftover) throw new Error(`flyer.html has a placeholder nothing filled in: ${leftover[0]}`);

const browser = await chromium.launch({ executablePath: chromiumPath() });
try {
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  // One page, or it is not a flyer. Content that grows past Letter would
  // silently spill onto a second sheet.
  const overflow = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
  if (overflow > 1) throw new Error(`the flyer is ${overflow}px taller than one Letter page — trim the copy`);

  await page.pdf({ path: `${OUT}.pdf`, width: "8.5in", height: "11in", printBackground: true, pageRanges: "1" });
  await page.screenshot({ path: `${OUT}.png`, fullPage: false });
} finally {
  await browser.close();
}

console.log(`  ${OUT.replace(ROOT + "/", "")}.pdf`);
console.log(`  ${OUT.replace(ROOT + "/", "")}.png`);

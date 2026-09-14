/**
 * Resolves which Chromium the browser suites should launch.
 *
 * Playwright looks for a browser under a build number pinned to its own
 * version, and downloads it when missing. Some environments ship a Chromium
 * already — under a different build number — and block the download host, so
 * the pinned lookup misses, `playwright install` cannot repair it, and the
 * suite is unrunnable despite a perfectly good browser being on disk.
 *
 * So: an explicit PLAYWRIGHT_CHROMIUM_PATH always wins, Playwright's own
 * choice is used whenever it actually exists, and only when neither holds do
 * we fall back to a Chromium already installed under the browsers root.
 * Returning undefined means "let Playwright decide", which is the default.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright';

const BROWSERS_ROOT =
  process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright');

// The per-platform layout Playwright unpacks a chromium build into.
const CANDIDATES = [
  join('chrome-linux', 'chrome'),
  join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  join('chrome-win', 'chrome.exe'),
];

const installedChromium = () => {
  let entries;
  try {
    entries = readdirSync(BROWSERS_ROOT);
  } catch {
    return undefined;
  }
  // Highest build number first, so a newer install wins over an older one.
  const builds = entries
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));

  for (const build of builds) {
    for (const candidate of CANDIDATES) {
      const path = join(BROWSERS_ROOT, build, candidate);
      if (existsSync(path)) return path;
    }
  }
  return undefined;
};

export const chromiumPath = () => {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;

  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    // executablePath() throws when nothing is registered at all; the fallback
    // below is exactly the case that covers.
  }

  return installedChromium();
};

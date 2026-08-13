/**
 * Drift guard for the auth gate.
 *
 *   npm test
 *
 * AUTH_GATED_ROUTES in App.jsx decides which paths wait for base44.auth.me()
 * before rendering. It has to match the routes actually nested under
 * <ProtectedRoute>, and the two are declared ~70 lines apart.
 *
 * Both directions are bugs, and neither is loud:
 *   - a protected route missing from the set renders its page for a moment
 *     before ProtectedRoute swaps in the fallback — a flash of signed-in UI at
 *     a signed-out visitor
 *   - a public route added to the set silently goes back to blocking first
 *     paint on an auth round-trip, which is the regression this set exists to
 *     prevent
 *
 * Parsing the source rather than importing it keeps this a plain node:test with
 * no JSX toolchain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8');

/** Paths listed in the AUTH_GATED_ROUTES set literal. */
function declaredGatedRoutes() {
  const block = SRC.match(/const AUTH_GATED_ROUTES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'AUTH_GATED_ROUTES set literal not found in App.jsx');
  return new Set([...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]));
}

/** Paths nested inside the <Route element={<ProtectedRoute .../>}> block. */
function protectedRoutePaths() {
  const start = SRC.indexOf('<ProtectedRoute');
  assert.notEqual(start, -1, '<ProtectedRoute> block not found in App.jsx');

  // Walk to the matching close of the wrapper <Route>, counting nested opens.
  const after = SRC.slice(start);
  const end = after.indexOf('</Route>');
  assert.notEqual(end, -1, 'unterminated <ProtectedRoute> block');

  return new Set(
    [...after.slice(0, end).matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]),
  );
}

test('every protected route is in AUTH_GATED_ROUTES', () => {
  const gated = declaredGatedRoutes();
  const protectedPaths = protectedRoutePaths();

  assert.ok(protectedPaths.size > 0, 'parsed zero protected routes — the parser has drifted');

  const missing = [...protectedPaths].filter((p) => !gated.has(p));
  assert.deepEqual(
    missing,
    [],
    `these routes sit under <ProtectedRoute> but are not in AUTH_GATED_ROUTES, so they ` +
      `will flash signed-in UI before the fallback replaces it: ${missing.join(', ')}`,
  );
});

test('AUTH_GATED_ROUTES contains nothing public', () => {
  const gated = declaredGatedRoutes();
  const protectedPaths = protectedRoutePaths();

  const extra = [...gated].filter((p) => !protectedPaths.has(p));
  assert.deepEqual(
    extra,
    [],
    `these are in AUTH_GATED_ROUTES but not under <ProtectedRoute>, so they block first ` +
      `paint on an auth round-trip for no reason: ${extra.join(', ')}`,
  );
});

test('the marketing routes are never auth-gated', () => {
  const gated = declaredGatedRoutes();
  for (const path of ['/', '/restaurants', '/about', '/blog', '/blog/podium-alternative', '/blog/qr-without-pos-change', '/blog/catch-1-star-early', '/blog/cost-of-one-lost-regular', '/changelog', '/privacy', '/terms']) {
    assert.equal(gated.has(path), false, `${path} must paint without waiting for auth`);
  }
});

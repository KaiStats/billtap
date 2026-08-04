/**
 * Session ids have to survive the round trip through a URL.
 *
 * They did not. billtap_id() base64-encoded twelve random bytes and replaced
 * the slash but not the plus, and eight call sites interpolated the result
 * straight into a query string. A plus in a query string decodes as a space, so
 * slightly more than one split in five produced a QR code the table could not
 * open and a host screen that said "Session not found" seconds after the bill
 * was created.
 *
 * Two halves to the fix and both are checked here: the generator emits
 * base64url now (migration 0006), and the links encode regardless — which is
 * what protects the ids migrated from Base44, minted by a system that made this
 * app no promises about its alphabet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { sessionPath, claimUrl } from './lib/sessionLinks.js';

/** What comes back when a browser reads the link we wrote. */
const idFrom = (url) => new URL(url, 'https://billtap.app').searchParams.get('id');

test('an id containing a plus survives the round trip', () => {
  const id = 'XTI6m+4pQBrOM7aw';
  assert.equal(idFrom(sessionPath('/claim', id)), id);
  assert.equal(idFrom(claimUrl('https://billtap.app', id)), id);

  // The exact failure this replaces: raw interpolation turns the plus into a
  // space, and the id that comes back is not the id that went out.
  assert.equal(idFrom(`/claim?id=${id}`), 'XTI6m 4pQBrOM7aw');
  assert.notEqual(idFrom(`/claim?id=${id}`), id);
});

test('every character base64 can produce survives', () => {
  // A–Z a–z 0–9 + / — the full alphabet, plus the _ and - the generator
  // substitutes and the = that padding would add.
  const id = 'AZaz09+/_-=';
  assert.equal(idFrom(sessionPath('/claim', id)), id);
});

test('extra parameters ride along and are encoded too', () => {
  const path = sessionPath('/receipt-detail', 'a+b', { host: 1 });
  const url = new URL(path, 'https://billtap.app');
  assert.equal(url.searchParams.get('id'), 'a+b');
  assert.equal(url.searchParams.get('host'), '1');
  assert.equal(url.pathname, '/receipt-detail');
});

test('links already in the world still read correctly', () => {
  // Nothing changes on the reading side, so an unencoded link from somebody's
  // message history — one whose id happens not to contain a plus — still works.
  assert.equal(idFrom('/claim?id=XTI6m_4pQBrOM7aw'), 'XTI6m_4pQBrOM7aw');
});

test('no page builds a session link by interpolation any more', () => {
  // The guard on the eight call sites. A ninth added later, written the old
  // way, fails here rather than at a restaurant table.
  const files = [
    'src/pages/SessionHost.jsx',
    'src/pages/Claim.jsx',
    'src/pages/ReceiptDetail.jsx',
    'src/pages/Dashboard.jsx',
    'src/pages/Home.jsx',
    'src/pages/NewReceipt.jsx',
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /[?&]id=\$\{/,
      `${file} interpolates a session id into a query string — use sessionPath()`,
    );
  }
});

test('the id generator emits base64url, not base64', () => {
  const sql = readFileSync(
    new URL('../supabase/migrations/0006_url_safe_ids_and_retention.sql', import.meta.url),
    'utf8',
  );
  // Both characters, in one translate. Replacing only the slash is the bug.
  assert.match(sql, /translate\(encode\(gen_random_bytes\(12\), 'base64'\), '\+\/', '-_'\)/);
});

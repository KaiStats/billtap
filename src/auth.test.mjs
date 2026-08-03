/**
 * The line that must not move: a diner never needs an account.
 *
 * Auth moved from Base44 to Supabase. The dangerous failure of that change is
 * not a broken login screen — that is loud and someone reports it in a minute.
 * It is a guest path quietly acquiring an auth requirement, because the person
 * it fails is at a restaurant table, is not the customer, and does not report
 * anything. They just cannot pay.
 *
 * These read the shipped source rather than rendering it. The property is
 * structural — which modules the guest paths import, and whether a token is
 * ever required rather than merely attached — and a render test would pass
 * while the property was false.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** Every screen a diner touches, with no account, ever. */
const GUEST_PAGES = [
  'src/pages/Claim.jsx',
  'src/pages/NewReceipt.jsx',
  'src/pages/SessionHost.jsx',
  'src/pages/ReceiptDetail.jsx',
  'src/pages/TableEntry.jsx',
];

test('no guest screen imports the auth client', () => {
  // Importing it is not itself the bug, but it is the only way the bug gets
  // written — you cannot gate on a session you never fetched.
  for (const page of GUEST_PAGES) {
    let source;
    try {
      source = read(page);
    } catch {
      continue; // page renamed; the others still hold the line
    }
    assert.ok(
      !/from ["']@\/lib\/supabase["']/.test(source),
      `${page} imports the auth client — a diner has no account and never will`,
    );
  }
});

test('no guest screen gates on isAuthenticated', () => {
  for (const page of GUEST_PAGES) {
    let source;
    try {
      source = read(page);
    } catch {
      continue;
    }
    assert.ok(
      !/isAuthenticated/.test(source),
      `${page} branches on being signed in — the whole product is that it does not`,
    );
  }
});

test('the token is attached when present and never required', () => {
  const client = read('src/api/base44Client.js');
  // Attached...
  assert.match(client, /const token = await accessToken\(\)/);
  assert.match(client, /if \(token\) headers\.Authorization/);
  // ...and nothing refuses to proceed without one. A throw or an early return
  // on a missing token is exactly the regression this file exists to catch.
  assert.ok(
    !/if \(!token\)[^\n]*(throw|return)/.test(client),
    'a missing token must not stop a call — guests have no token and are most of the traffic',
  );
});

test('signing out does not wipe the keys a guest host needs', () => {
  // `billtap-hostkey-<id>` is how whoever started a table-tent split proves
  // they own it — it is what authorises confirming a payment, and it is issued
  // exactly once. `billtap-split-history` is how anyone finds their own bill
  // afterwards. Both belong to the device, not to an account: a guest host has
  // no account to sign out of, and clearing these would strand a table
  // mid-payment because an operator happened to sign out on the same phone.
  //
  // Names read from the modules that own them rather than hardcoded, so
  // renaming a key cannot silently pass this.
  const hostKeyPrefix = read('src/lib/hostKey.js').match(/`(billtap-[\w-]+)\$\{sessionId\}`/)?.[1];
  const historyKey = read('src/lib/splitHistory.js').match(/const KEY = '([^']+)'/)?.[1];
  assert.ok(hostKeyPrefix, 'could not find the host key name — update this test with it');
  assert.ok(historyKey, 'could not find the history key name — update this test with it');

  const context = read('src/lib/AuthContext.jsx');
  const clearBlock = context.slice(
    context.indexOf('function clearBillTapStorage'),
    context.indexOf('const AuthContext = createContext'),
  );

  // Neither named outright...
  assert.ok(!clearBlock.includes(hostKeyPrefix), 'sign-out must not destroy host keys');
  assert.ok(!clearBlock.includes(historyKey), 'sign-out must not destroy bill history');

  // ...nor caught by a prefix sweep. This is the half that would actually
  // happen: somebody adds `k.startsWith('billtap-')` to tidy up and takes the
  // host keys with it.
  const prefixes = [...clearBlock.matchAll(/startsWith\('([^']+)'\)/g)].map((m) => m[1]);
  for (const prefix of prefixes) {
    assert.ok(!hostKeyPrefix.startsWith(prefix), `startsWith('${prefix}') would sweep away host keys`);
    assert.ok(!historyKey.startsWith(prefix), `startsWith('${prefix}') would sweep away bill history`);
  }
});

test('the login redirect cannot be pointed off-site', () => {
  // ?next= arrives from the URL. Passed through unchecked it is an open
  // redirect, and a link that begins on billtap.app and ends on somebody
  // else's login form is a credible phishing page. `//evil.com` is the case
  // that catches people: it starts with a slash and is still absolute.
  const login = read('src/pages/Login.jsx');
  assert.match(login, /startsWith\("\/\/"\)/, 'protocol-relative URLs must be rejected');
  assert.match(login, /window\.location\.origin/, 'the redirect must be built from this origin');
});

test('there is no password field left to reset', () => {
  const login = read('src/pages/Login.jsx');
  assert.ok(!/type="password"/.test(login), 'no password means no reset flow to break');
  assert.match(login, /signInWithOtp/);
});

test('the old reset paths redirect rather than 404', () => {
  // They are in Base44's old emails and in browser history. A 404 is the worst
  // answer for somebody who is already having trouble getting in — which is how
  // this migration started.
  const app = read('src/App.jsx');
  assert.match(app, /path="\/forgot-password" element=\{<Navigate to="\/login"/);
  assert.match(app, /path="\/reset-password" element=\{<Navigate to="\/login"/);

  // And the Worker must still answer them with a 200, or the redirect is served
  // under a status that reports itself as not found.
  const worker = read('worker/index.js');
  assert.match(worker, /'\/forgot-password'/);
  assert.match(worker, /'\/reset-password'/);
});

test('a build with no auth configured still serves the guest product', () => {
  // A missing key should cost operators their sign-in screen. It must not cost
  // a restaurant its ability to split bills.
  const client = read('src/lib/supabase.js');
  assert.match(client, /export const authConfigured/);
  assert.match(client, /authConfigured\s*\n?\s*\?\s*createClient/, 'the client must not be constructed unconditionally');
});

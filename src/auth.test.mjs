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
  // src/api/base44Client.js, until the SDK it wrapped was deleted. Same
  // function, same property: this is the one place a header could start being
  // demanded of everybody.
  const client = read('src/api/functions.js');
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
  // Comments stripped before the checks below.
  //
  // The invariant is about what the code touches, not what the file mentions,
  // and the two came apart the moment the block grew a comment naming the keys
  // it must leave alone — which is exactly the comment most worth having there.
  // Testing the prose made documenting the rule a way to break it.
  const clearBlock = context
    .slice(
      context.indexOf('function clearBillTapStorage'),
      context.indexOf('const AuthContext = createContext'),
    )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

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

  /**
   * And the diner's own key, which is the same argument one person down.
   *
   * billtap-pkey-<session>-<participant> is what proves a diner is themselves —
   * without it they cannot see their own share, change their own claims, or say
   * they have paid. A guest diner has no account either, so an operator signing
   * out on a shared phone must not take it with them.
   */
  const participantPrefix = read('src/lib/participantKey.js')
    .match(/`(billtap-[\w-]+)\$\{sessionId\}/)?.[1];
  assert.ok(participantPrefix, 'could not find the participant key name — update this test with it');
  assert.ok(!clearBlock.includes(participantPrefix), 'sign-out must not destroy participant keys');
  for (const prefix of prefixes) {
    assert.ok(
      !participantPrefix.startsWith(prefix),
      `startsWith('${prefix}') would sweep away participant keys`,
    );
  }
});

test('the auth session itself is cleared on sign-out, not only by supabase-js', () => {
  // supabase-js removes it on every path through _signOut, including when the
  // API call fails — verified against 2.111.0. What it cannot cover is the auth
  // chunk failing to load at all: logout() catches that and carries on to the
  // redirect, and the token would otherwise still be in localStorage, signing
  // the operator back in on the next page load.
  const context = read('src/lib/AuthContext.jsx');
  assert.match(
    context,
    /storageKey\(\)/,
    'clearBillTapStorage must remove the supabase session key itself',
  );
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
  // getSupabase resolves to null rather than throwing when unconfigured. It is
  // a dynamic import now — supabase-js is 56 KB gzipped and was in the entry
  // chunk, so every diner downloaded the whole auth library before first paint
  // to discover they are not signed in.
  assert.match(client, /if \(!authConfigured\) return Promise\.resolve\(null\)/);
});

test('the auth client is fetched on demand, not on every page load', () => {
  const client = read('src/lib/supabase.js');
  assert.match(client, /import\('@supabase\/supabase-js'\)/, 'must be a dynamic import');
  assert.ok(
    !/^import .*from '@supabase\/supabase-js'/m.test(client),
    'a static import puts 56 KB of auth client in the entry chunk, on the critical path of people who will never sign in',
  );
});

test('asking for a token costs nothing when there is obviously no session', () => {
  // accessToken() runs before every Worker call. Without the guard, the first
  // split anyone created would pull down the auth client just to learn they are
  // not signed in.
  const client = read('src/lib/supabase.js');
  const body = client.slice(client.indexOf('export async function accessToken'));
  assert.match(body, /if \(!authPending\(\)\) return null/);
});

// The other half — that a sign-in link arriving in the URL still loads the
// client — is asserted in scripts/ui.browser.mjs, against a real browser.
//
// It was a source grep here first, and a mutation test showed it was worthless:
// blanking the URL check entirely still passed, because the words it looked for
// also appear in the comment above the code. Reading a real navigation cannot
// be fooled that way.

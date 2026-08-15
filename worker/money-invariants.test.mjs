/**
 * The settlement invariants.
 *
 * BillTap moves no money for a split. Diners pay the host through whatever
 * handle the host set — Venmo, Cash App, cash across the table — and the app is
 * a ledger over that, never a processor. Which makes one rule load-bearing for
 * the whole product:
 *
 *     Only the host confirming can mark a diner settled.
 *
 * A diner tapping "I paid" is a claim, not a settlement: markMePaid writes
 * pending_verification. The host, holding the host key, is the only party who
 * can turn that into 'paid' — because the host is the only one who can actually
 * see the money arrive. That is also why a host can confirm someone who never
 * touched the app: cash settles the same way, and the app is reporting what the
 * host observed rather than detecting anything itself.
 *
 * ── Why these read source instead of calling handlers ─────────────────────
 *
 * The behavioural suite already covers today's handlers ("paying moves the
 * diner to pending_verification, never straight to paid", "a split completes
 * only when the host has confirmed every diner"). All of those keep passing if
 * someone adds a NEW handler next year that writes payment_status: 'paid'
 * directly — they exercise named functions, so they cannot see a function that
 * did not exist when they were written. These read the file instead, in the
 * same shape as App.routes.test.mjs's AUTH_GATED_ROUTES checks, and fail on the
 * addition itself.
 *
 * ── When one of these fails ───────────────────────────────────────────────
 *
 * Treat it as the design question it is. If BillTap ever takes card payments
 * for splits, or something other than host confirmation settles a diner, that
 * is a deliberate change to the trust model AND to the regulatory posture —
 * holding no funds is what keeps money transmission and PCI scope out of the
 * split path. Change the test with the change. Do not widen it to go green.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'routes', 'functions.js'), 'utf8');

/** Handler bodies keyed by name: each spans one `  async name(` to the next. */
function handlerBodies() {
  const marks = [];
  // `{2}` rather than two literal spaces: identical to match, and the literal
  // form is what no-regex-spaces refuses — two spaces in a regex are invisible
  // to a reviewer, and this one decides where every handler body begins.
  const re = /\n {2}async (\w+)\(/g;
  let m;
  while ((m = re.exec(SRC)) !== null) marks.push({ name: m[1], start: m.index });

  const out = {};
  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : SRC.length;
    out[mark.name] = SRC.slice(mark.start, end);
  });
  return out;
}

/** Assignments, not comparisons. `p.payment_status === 'paid'` must not match. */
const PAID_ASSIGNMENT = /payment_status:\s*'paid'/g;

test('only one place in the split logic can mark a diner paid', () => {
  const hits = SRC.match(PAID_ASSIGNMENT) || [];
  assert.equal(hits.length, 1,
    "payment_status: 'paid' is assigned " + hits.length + ' times in functions.js. ' +
    'Exactly one assignment should exist, in confirmPayment. A new path that ' +
    'settles a diner changes who is trusted to say money arrived — decide that ' +
    'deliberately rather than widening this test.');
});

test('that place is confirmPayment', () => {
  const bodies = handlerBodies();
  assert.ok(bodies.confirmPayment, 'confirmPayment handler not found in functions.js');
  assert.equal((bodies.confirmPayment.match(PAID_ASSIGNMENT) || []).length, 1,
    'confirmPayment should be the single handler writing payment_status: ' +
    "'paid'. The host is the only party who can see the money land, so the " +
    'host is the only party who may record that it did.');
});

test('a diner reporting payment can only claim, never settle', () => {
  const bodies = handlerBodies();
  assert.ok(bodies.markMePaid, 'markMePaid handler not found in functions.js');
  assert.equal((bodies.markMePaid.match(PAID_ASSIGNMENT) || []).length, 0,
    "markMePaid must never write payment_status: 'paid'. A diner saying they " +
    'sent money is a claim about the outside world the app cannot check.');
  assert.match(bodies.markMePaid, /pending_verification/,
    'markMePaid should write pending_verification — "claimed, not confirmed", ' +
    'which the host screen renders as "says they sent it".');
});

test('the split path never reaches a payment processor', () => {
  for (const needle of ['STRIPE_SECRET_KEY', 'api.stripe.com']) {
    assert.equal(SRC.includes(needle), false,
      'functions.js references ' + needle + '. Splits move no money through ' +
      'BillTap; that is what keeps money transmission, PCI scope and ' +
      'chargebacks out of the product. Stripe is subscription billing only.');
  }
});

test('Stripe stays confined to subscription billing', () => {
  // An allowlist, like AUTH_GATED_ROUTES: Stripe appearing in a new file should
  // fail here and force the question "should this file handle money?".
  //
  // Note for anyone reading a grep: verify-checkout.js also matches
  // /payment_status.*paid/, but that is STRIPE'S field on a checkout session,
  // describing a restaurant subscription — nothing to do with a diner. Same
  // name, unrelated meaning. The diner invariants above therefore read
  // functions.js and only functions.js.
  const ALLOWED = [
    'lib/environment.js',
    'routes/create-checkout.js',
    'routes/reconcile-billing.js',
    'routes/verify-checkout.js',
    /**
     * Consumer Pro, added on purpose.
     *
     * The $0.99 tier is a subscription like the $149 one, so it belongs in the
     * same list rather than in a new category. Unlike create-checkout it
     * authenticates: the plan attaches to a person, so who it is for comes from
     * a verified session and never from the request body.
     */
    'routes/create-pro-checkout.js',
    /**
     * Stripe telling us what happened, for both products.
     *
     * It reads the key to fetch the subscription back rather than trusting what
     * arrived in the payload. Worth this list knowing about, because it is the
     * only route here that grants a paid plan without a browser involved — the
     * HMAC on every delivery is what stands in for a credential.
     */
    'routes/stripe-webhook.js',
  ];

  const found = [];
  (function walk(dir, rel) {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue;
      const full = join(dir, entry);
      const relPath = rel ? rel + '/' + entry : entry;
      if (statSync(full).isDirectory()) walk(full, relPath);
      else if (entry.endsWith('.js') &&
               readFileSync(full, 'utf8').includes('STRIPE_SECRET_KEY')) {
        found.push(relPath);
      }
    }
  })(HERE, '');

  assert.deepEqual(found.sort(), [...ALLOWED].sort(),
    'the set of Worker files reading STRIPE_SECRET_KEY changed. Money handling ' +
    'belongs in the billing routes; if a new file legitimately needs it, add it ' +
    'to this list on purpose.');
});

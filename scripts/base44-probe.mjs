#!/usr/bin/env node
/**
 * What does Base44 actually answer, and to which credential?
 *
 * Exists because the first live migration run read zero rows from all seven
 * entities and reported success. Zero is not plausible for this app, so
 * something between the request and the data is wrong — and the failure is
 * silent, which is the worst kind to guess at.
 *
 * The candidates are narrow. readAll throws on a non-2xx, so it was not a 401.
 * That leaves: a credential Base44 accepts but does not recognise as the app
 * (answering 200 with an empty, RLS-scoped list), a response envelope this code
 * does not unwrap, or an entity name that does not exist under that name.
 *
 * So ask, and print exactly what comes back rather than interpreting it. This
 * reads only, and it never prints a key.
 *
 *   node scripts/base44-probe.mjs
 *   node scripts/base44-probe.mjs Session
 *
 * Environment: BASE44_APP_ID, BASE44_MASTER_KEY
 */

const ENTITIES = ['Restaurant', 'Session', 'GuestRating', 'GuestContact', 'RestaurantLead', 'Waitlist', 'Receipt'];

/**
 * The ways a server-to-server credential might have to be presented.
 *
 * base44.js sends Bearer, and that shape was taken from the browser proxy —
 * where the token is a user's session, not a master key. Whether Base44 accepts
 * a master key the same way has never been proven against this app. `api_key`
 * is the other documented form.
 */
const SCHEMES = [
  { name: 'Authorization: Bearer', headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  { name: 'api_key',               headers: (key) => ({ api_key: key }) },
  { name: 'X-API-Key',             headers: (key) => ({ 'X-API-Key': key }) },
  { name: 'no credential',         headers: () => ({}) },
];

/** A one-line account of a response body, without dumping anyone's dinner. */
function describe(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return `not JSON: ${text.slice(0, 120)}`;
  }
  if (Array.isArray(parsed)) {
    const keys = parsed.length ? Object.keys(parsed[0]).slice(0, 8).join(', ') : '';
    return `array of ${parsed.length}${keys ? ` — fields: ${keys}…` : ' (empty)'}`;
  }
  if (parsed && typeof parsed === 'object') {
    // The envelope question: if rows arrive under a key the migration does not
    // unwrap, it sees nothing and reports zero.
    const shape = Object.entries(parsed)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? `array of ${v.length}` : typeof v}`)
      .slice(0, 8)
      .join(', ');
    return `object { ${shape} }`;
  }
  return `${typeof parsed}: ${String(parsed).slice(0, 80)}`;
}

async function main() {
  const appId = (process.env.BASE44_APP_ID || '').replace(/^app_/, '');
  const key = process.env.BASE44_MASTER_KEY;
  const origin = (process.env.BASE44_API_ORIGIN || 'https://base44.app').replace(/\/+$/, '');
  if (!appId || !key) {
    console.error('BASE44_APP_ID and BASE44_MASTER_KEY must be set.');
    process.exit(1);
  }

  const only = process.argv[2];
  const entities = only ? [only] : ENTITIES;

  console.log(`\nProbing ${origin}/api/apps/${appId}\n`);

  // Which credential form works at all. One entity is enough to answer it, and
  // trying every scheme against every entity would be noise.
  console.log(`Credential forms, against ${entities[0]}:\n`);
  for (const scheme of SCHEMES) {
    const url = `${origin}/api/apps/${appId}/entities/${entities[0]}?limit=3`;
    try {
      const res = await fetch(url, { headers: scheme.headers(key) });
      const text = await res.text();
      console.log(`  ${scheme.name.padEnd(22)} ${String(res.status).padEnd(4)} ${describe(text)}`);
    } catch (err) {
      console.log(`  ${scheme.name.padEnd(22)} ---  request failed: ${err.message}`);
    }
  }

  // A 200 with an empty array under a credential Base44 does not recognise as
  // the app looks identical to an app with no data. The one below distinguishes
  // them: if no credential also returns 200 and an empty array, the credential
  // is being ignored and the emptiness means nothing.
  console.log('\nRow counts per entity, with the Bearer form the migration uses:\n');
  for (const entity of entities) {
    const url = `${origin}/api/apps/${appId}/entities/${entity}?limit=200&offset=0`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      const text = await res.text();
      console.log(`  ${entity.padEnd(16)} ${String(res.status).padEnd(4)} ${describe(text)}`);
    } catch (err) {
      console.log(`  ${entity.padEnd(16)} ---  request failed: ${err.message}`);
    }
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  //
  // Everything above can come back 200 and empty for two unrelated reasons: a
  // credential Base44 does not recognise, or a URL that answers 200 and empty
  // to absolutely anything. Those need different fixes, so guessing between
  // them is how the wrong one gets made.
  //
  // Each line below is a question with only one interesting answer.

  console.log('\nControls — a 200 here means the reply above was never about your data:\n');

  const controls = [
    {
      // If an app id that cannot exist answers the same as yours, the endpoint
      // is not looking anything up and the path is wrong.
      label: 'app id that cannot exist',
      url: `${origin}/api/apps/000000000000000000000000/entities/Restaurant?limit=3`,
      headers: { Authorization: `Bearer ${key}` },
      want: 'want 404 or 403 — a 200 means the app id is not being checked',
    },
    {
      // Same question from the other side: an entity nobody ever defined.
      label: 'entity that was never defined',
      url: `${origin}/api/apps/${appId}/entities/ThisEntityDoesNotExist?limit=3`,
      headers: { Authorization: `Bearer ${key}` },
      want: 'want 404 — a 200 means entity names are not being checked either',
    },
    {
      // The direct question: does Base44 know this credential at all? An
      // identity back means the key is good and the lists really are empty. A
      // 401 means the key is not being accepted and every zero above is noise.
      label: 'who does this key say I am',
      url: `${origin}/api/apps/${appId}/entities/User/me`,
      headers: { Authorization: `Bearer ${key}` },
      want: 'want an identity — a 401 means the key is not recognised',
    },
    {
      // The remaining credential form worth trying: as a query parameter rather
      // than a header. Worth knowing that this puts the key in a URL, where it
      // can land in an access log at the other end — acceptable for one
      // diagnostic run against a key that is being rotated anyway, and not
      // something to adopt as the way the migration authenticates.
      label: 'key as a query parameter',
      url: `${origin}/api/apps/${appId}/entities/Restaurant?limit=3&api_key=${encodeURIComponent(key)}`,
      headers: {},
      want: 'rows here would name the form the migration should use',
    },
  ];

  for (const control of controls) {
    try {
      const res = await fetch(control.url, { headers: control.headers });
      const text = await res.text();
      console.log(`  ${control.label.padEnd(28)} ${String(res.status).padEnd(4)} ${describe(text)}`);
      console.log(`  ${''.padEnd(28)}      ${control.want}`);
    } catch (err) {
      console.log(`  ${control.label.padEnd(28)} ---  request failed: ${err.message}`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});

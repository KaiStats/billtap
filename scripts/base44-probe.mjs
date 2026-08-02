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
  console.log('');
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});

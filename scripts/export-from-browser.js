/**
 * Get the data out of Base44 from the browser, where the credentials work.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * scripts/migrate-to-supabase.mjs reads Base44 over the server API with the
 * master key, and against this app that returns 200 and an empty array for
 * every entity — including with no credential at all, which is how we know the
 * key is being ignored rather than the tables being empty.
 *
 * Rather than reverse-engineer a vendor's server auth on the way out of that
 * vendor, use the one path that demonstrably works: the browser. The app holds
 * a live Base44 access token in localStorage and reads entities same-origin
 * through worker/routes/base44-proxy.js on every page load. That is the same
 * API, with a credential Base44 accepts.
 *
 * ── Using it ────────────────────────────────────────────────────────────────
 *
 * 1. Open https://billtap.app and sign in as the account that owns the
 *    restaurants. It has to be that account — you can only export what you can
 *    read, and that is the point.
 * 2. Open the browser console (Cmd+Option+J on Chrome, Cmd+Option+C on Safari
 *    once Develop is enabled).
 * 3. Paste this whole file and press Enter.
 * 4. It downloads base44-export.json. Move it into the repo.
 *
 *      node scripts/migrate-to-supabase.mjs --from-file ~/Downloads/base44-export.json --dry-run
 *
 * It reads. It writes nothing and deletes nothing.
 *
 * ── What you should expect to see ───────────────────────────────────────────
 *
 * Counts per entity, printed as it goes. Restaurant is the one that matters:
 * those are paying customers, and if that number is zero here too then the data
 * genuinely is not there and there is nothing to migrate — which is an answer,
 * and a much better one than a silent zero.
 */

(async () => {
  const ENTITIES = [
    'Restaurant', 'Session', 'GuestRating', 'GuestContact',
    'RestaurantLead', 'Waitlist', 'Receipt',
  ];
  const PAGE = 200;

  const appId = (localStorage.getItem('base44_app_id') || '').replace(/^app_/, '');
  const token = localStorage.getItem('base44_access_token') || localStorage.getItem('token');

  if (!appId) {
    console.error('No base44_app_id in localStorage. Are you on billtap.app?');
    return;
  }
  if (!token) {
    console.warn('No access token in localStorage — falling back to the session cookie alone.');
    console.warn('If everything comes back empty, sign in first and run this again.');
  }

  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  /** One entity, paged, through the same same-origin proxy the app uses. */
  async function readAll(entity) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await fetch(
        `/api/apps/${appId}/entities/${entity}?limit=${PAGE}&offset=${offset}`,
        { headers, credentials: 'same-origin' },
      );
      if (!res.ok) {
        console.error(`  ${entity}: ${res.status} ${await res.text()}`);
        return rows;
      }
      const page = await res.json();
      const list = Array.isArray(page) ? page : page?.data;
      if (!Array.isArray(list) || list.length === 0) break;
      rows.push(...list);
      // A short page is the last page.
      if (list.length < PAGE) break;
    }
    return rows;
  }

  const out = {};
  for (const entity of ENTITIES) {
    out[entity] = await readAll(entity);
    console.log(`  ${entity.padEnd(16)} ${out[entity].length}`);
  }

  const total = Object.values(out).reduce((n, rows) => n + rows.length, 0);
  if (total === 0) {
    console.error('\nEverything is empty here too, with a credential this app uses every day.');
    console.error('That is a real answer: there is nothing in Base44 to migrate.');
    console.error('Downloading anyway so the result is on the record.');
  }

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'base44-export.json';
  a.click();
  URL.revokeObjectURL(url);

  console.log(`\n${total} rows exported to base44-export.json`);
})();

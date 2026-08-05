/**
 * Supabase in the browser. Auth and storage only.
 *
 * ── What this client is and is not for ──────────────────────────────────────
 *
 * Auth: yes. Sign-in, sign-out, session refresh, OAuth. That is what
 * supabase-js is good at and it is where the value is.
 *
 * Data: no. The browser never talks to Postgres in this app, and the reason is
 * structural rather than stylistic — the people who use BillTap have no
 * accounts. A diner scanning a table tent has no Supabase identity, so
 * auth.uid() is null and no row level security policy can scope them. What
 * actually guards the money here is the host key and the participant id, and
 * neither is something Postgres can check. So every read and write goes through
 * the Worker, which authorises against stored data, and that code is
 * mutation-tested. See worker/lib/db.js.
 *
 * The schema enforces this: RLS is on everywhere with almost no policies, so a
 * query from here gets nothing back rather than getting something wrong.
 *
 * ── The key ─────────────────────────────────────────────────────────────────
 *
 * The anon key is public and belongs in the bundle — that is what it is for.
 * The service role key must never appear anywhere under src/. Anything prefixed
 * VITE_ ships to every browser that loads the page.
 */
// `?? {}` so this module can be loaded outside a bundle. vite replaces
// import.meta.env with a real object; node leaves it undefined, and reading a
// property off that throws before any test can get to the thing it came to
// check. Absent means unconfigured, which is a state this file already handles.
const env = import.meta.env ?? {};

const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;

/**
 * Whether sign-in is available at all.
 *
 * Exported because the alternative is a client that throws on construction and
 * takes the whole app down with it — including every guest path, none of which
 * needs auth. A missing key should cost operators their sign-in screen, not
 * cost a restaurant its ability to split bills.
 *
 * scripts/check-env.mjs fails a production build without these, so this being
 * false in production means somebody bypassed the gate.
 */
export const authConfigured = Boolean(url && anonKey);

/**
 * ── Why the client is loaded on demand ──────────────────────────────────────
 *
 * supabase-js is 56 KB gzipped and it was in the entry chunk, which meant every
 * diner downloaded the whole auth client before the page painted. Measured:
 * the entry chunk went 223 KB → 168 KB gzipped with it removed. A quarter of
 * the blocking bytes, on the critical path of people who by design will never
 * sign in — most of the traffic this product serves is a stranger at a table
 * with one bar of signal.
 *
 * So it is a dynamic import, gated on a synchronous check that costs nothing:
 * if there is no stored session and no sign-in callback in the URL, nobody
 * needs an auth client and none is fetched.
 */

/** The localStorage key supabase-js keeps its session under: sb-<ref>-auth-token. */
export function storageKey() {
  try {
    // The project ref is the first label of the hostname. Derived rather than
    // configured, because a second variable that must agree with the URL is a
    // second thing that can disagree with it.
    const ref = new URL(url).hostname.split('.')[0];
    return `sb-${ref}-auth-token`;
  } catch {
    return null;
  }
}

/**
 * Is there anything for an auth client to do on this page load?
 *
 * Synchronous and cheap — a localStorage read and a look at the URL — so the
 * common answer (no) is reached without fetching anything.
 *
 * Both halves are needed. The stored session covers an operator returning to a
 * tab. The URL check covers the moment a magic link is opened, when the session
 * has arrived in the address bar and nothing is stored yet: missing that would
 * make the sign-in link silently do nothing, which is precisely the failure
 * this whole migration exists to end.
 */
export function authPending() {
  if (!authConfigured) return false;
  try {
    const key = storageKey();
    if (key && window.localStorage.getItem(key)) return true;
  } catch {
    // Private mode, or storage disabled. Fall through to the URL check.
  }
  try {
    const { hash, search } = window.location;
    // Implicit flow puts the token in the fragment; PKCE returns ?code=.
    // `error=` matters too — a rejected link must reach the code that can
    // report it rather than looking like an ordinary anonymous visit.
    return /[#&](access_token|error)=/.test(hash) || /[?&](code|error)=/.test(search);
  } catch {
    return false;
  }
}

let clientPromise = null;

/**
 * The auth client, imported on first use and reused thereafter.
 *
 * Returns null when auth is not configured, rather than throwing. A missing key
 * should cost operators their sign-in screen; it must not cost a restaurant its
 * ability to split a bill.
 */
export function getSupabase() {
  if (!authConfigured) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) =>
        createClient(url, anonKey, {
          auth: {
            // The session survives a reload, which matters more here than
            // usual: an operator on a phone switching to their email app to
            // fetch a magic link and coming back must not find themselves
            // signed out.
            persistSession: true,
            autoRefreshToken: true,
            // Magic links and OAuth both come back with the session in the URL.
            // Without this the token sits in the address bar unread.
            detectSessionInUrl: true,
          },
        }),
      )
      .catch(() => {
        // A failed chunk fetch — offline, or a blocker eating the request.
        // Reset so a later attempt can retry rather than being stuck with a
        // rejected promise for the life of the page.
        clientPromise = null;
        return null;
      });
  }
  return clientPromise;
}

/**
 * The access token for the current session, or null.
 *
 * Null is the ordinary case, not a failure — guests are the whole premise of
 * this product. Callers must treat it as such rather than as an error.
 *
 * The authPending() guard is what keeps this off the critical path: it is
 * called before every Worker request, and without it the first split anyone
 * created would pull down the auth client to discover they are not signed in.
 */
export async function accessToken() {
  if (!authPending()) return null;
  try {
    const client = await getSupabase();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

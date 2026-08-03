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
import { createClient } from '@supabase/supabase-js';

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

export const supabase = authConfigured
  ? createClient(url, anonKey, {
      auth: {
        // The session survives a reload, which matters more here than usual:
        // an operator on a phone switching to their email app to fetch a magic
        // link and coming back must not find themselves signed out.
        persistSession: true,
        autoRefreshToken: true,
        // Magic links and OAuth both come back with the session in the URL
        // fragment. Without this the token sits in the address bar unread.
        detectSessionInUrl: true,
      },
    })
  : null;

/**
 * The access token for the current session, or null.
 *
 * Null is the ordinary case, not a failure — guests are the whole premise of
 * this product. Callers must treat it as such rather than as an error.
 */
export async function accessToken() {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

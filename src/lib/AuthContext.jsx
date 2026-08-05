import React, { createContext, useState, useContext, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { getSupabase, authConfigured, authPending, storageKey } from '@/lib/supabase';

/**
 * Who is signed in, if anyone.
 *
 * ── Nobody is, most of the time, and that is correct ────────────────────────
 *
 * Only restaurant operators have accounts. Every diner — the large majority of
 * traffic — is anonymous by design, so `isAuthenticated: false` is the normal
 * state of this context and not an error to be recovered from. Nothing here may
 * redirect, prompt or block on that basis.
 *
 * ── Why the exported shape is unchanged from the Base44 version ─────────────
 *
 * Six files consume this context. Keeping the same nine keys means the auth
 * provider changed and nothing else did, which is what makes this reviewable: a
 * diff that touched ProtectedRoute and Dashboard at the same time would be
 * hiding an auth change inside a UI change.
 *
 * `authError` and `appPublicSettings` are kept for that reason even though
 * Supabase produces neither. They are always null now. Removing them is a
 * separate, boring commit.
 */

// Everything this app puts in the browser, cleared on sign-out.
function clearBillTapStorage() {
  const keysToRemove = [
    'billtap-active-session',
    'billtap_participant_id',
    'billtap_participant_name',
    'billtap-session-cache',
    'billtap-last-session',
    'divvy_participant_id',   // legacy key
    'divvy_participant_name', // legacy key
  ];
  keysToRemove.forEach(k => localStorage.removeItem(k));

  // Per-session guest keys.
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('billtap-guest-name-') || k.startsWith('participant-') || k.startsWith('claimed-')) {
      localStorage.removeItem(k);
    }
  });

  sessionStorage.clear();

  /**
   * The auth session itself, removed here as well as by signOut().
   *
   * supabase-js clears it on every path through _signOut, including when the
   * API call fails — checked against 2.111.0 rather than assumed. What it
   * cannot cover is the case where the auth client never loads at all: offline,
   * or a chunk that fails to fetch. logout() catches that and carries on to the
   * redirect, and without this the session token would still be sitting in
   * localStorage afterwards, so the next page load signs the operator back in.
   *
   * Removing a key supabase-js also removes is harmless; not removing it when
   * supabase-js never ran is not.
   */
  try {
    const authKey = storageKey();
    if (authKey) localStorage.removeItem(authKey);
  } catch {
    // Private mode. Nothing was stored, so nothing to clear.
  }

  Sentry.setUser(null);
  Sentry.setTag('split_mode', null);
}

/**
 * Deliberately NOT cleared on sign-out: the per-split host keys
 * (billtap-hostkey-<id>, src/lib/hostKey.js), the per-diner participant keys
 * (billtap-pkey-<session>-<participant>, src/lib/participantKey.js) and the
 * bill history (billtap-split-history, src/lib/splitHistory.js).
 *
 * They are how a guest host proves they own a split, how a diner proves which
 * share is theirs, and how anyone finds their own bill history. They belong to
 * the device, not to an account — a host with no account has nothing to sign
 * out of, and wiping them would strand a table mid-payment because an operator
 * happened to sign out on the same phone.
 *
 * (This note previously named billtap_host_keys and billtap_splits. Neither has
 * ever existed. The keys above are the real ones, and the difference matters:
 * the loop below matches by prefix, so a wrong name here is how somebody
 * "tidies up" a prefix that is load-bearing.)
 */

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Starts true and only goes false once resolved. If it started false,
  // ProtectedRoute would see isAuthenticated: false on the first paint and
  // bounce a signed-in operator to the login screen before the session loaded.
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings] = useState(false);
  const [authError] = useState(null);
  const [appPublicSettings] = useState(null);

  const applySession = (session) => {
    const nextUser = session?.user || null;
    setUser(nextUser);
    setIsAuthenticated(Boolean(nextUser));
    Sentry.setUser(nextUser ? { id: nextUser.id, email: nextUser.email } : null);
  };

  useEffect(() => {
    // The common case, and it costs one localStorage read: no stored session
    // and no sign-in callback in the URL means nobody here has an account, so
    // the 56 KB auth client is never fetched. See authPending() for why the URL
    // half is not optional.
    //
    // !authConfigured lands here too — no sign-in available at all. Guests are
    // unaffected either way, which is the point: a missing key must not take
    // the product down for people who never needed an account.
    if (!authConfigured || !authPending()) {
      setIsLoadingAuth(false);
      return undefined;
    }

    let cancelled = false;
    let unsubscribe = null;

    getSupabase()
      .then(async (client) => {
        if (!client) {
          if (!cancelled) setIsLoadingAuth(false);
          return;
        }

        // Fires on sign-in, sign-out and every token refresh, including in
        // another tab. Subscribed before the first read so a session arriving
        // from a magic link in the URL — which supabase-js resolves
        // asynchronously — is not missed between the two calls.
        const { data } = client.auth.onAuthStateChange((_event, session) => {
          if (cancelled) return;
          applySession(session);
          setIsLoadingAuth(false);
        });
        unsubscribe = () => data?.subscription?.unsubscribe();

        const { data: current } = await client.auth.getSession();
        if (!cancelled) {
          applySession(current?.session);
          setIsLoadingAuth(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          applySession(null);
          setIsLoadingAuth(false);
        }
      });

    return () => {
      cancelled = true;
      // Or the listener outlives the tree and fires setState against unmounted
      // components on every token refresh.
      unsubscribe?.();
    };
  }, []);

  const logout = async () => {
    // Local state first, so the UI updates even if the network call hangs. The
    // request that matters has already been made by the time anyone notices.
    setUser(null);
    setIsAuthenticated(false);
    clearBillTapStorage();
    try {
      const client = await getSupabase();
      if (client) await client.auth.signOut();
    } catch {
      // Already signed out server-side, or offline. Either way the local
      // session is gone, which is what was asked for.
    }
    window.location.href = '/';
  };

  const navigateToLogin = () => {
    // The current URL is preserved so the magic link returns here rather than
    // to the home page — an operator who clicked through to the dashboard
    // should land on the dashboard.
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
  };

  /** Kept for the callers that re-check after an action. */
  const checkAppState = async () => {
    if (!authConfigured) return;
    const client = await getSupabase();
    if (!client) return;
    const { data } = await client.auth.getSession();
    applySession(data?.session);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

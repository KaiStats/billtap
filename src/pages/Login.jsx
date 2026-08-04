import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { QrCode, Mail } from "lucide-react";
import { getSupabase, authConfigured } from "@/lib/supabase";

/**
 * Sign in. Operators only — diners never see this screen.
 *
 * ── Why there is no password field ──────────────────────────────────────────
 *
 * There are a few dozen operators. The scale that justifies a password system
 * is not present, and the cost of one was not hypothetical: the previous reset
 * flow ran on a third party's domain, with a link that 404'd, and it locked the
 * owner out of his own product. That is not a flow to reimplement more
 * carefully — it is a flow to delete.
 *
 * No password means no reset, no credential stuffing, no hash migration, no
 * "was that password reused elsewhere" incident. Whoever controls the inbox can
 * sign in, which was already true of any system with a reset link.
 *
 * Google stays, because several operators already use it and it costs one call.
 */
export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Fetch the auth client now rather than on the click.
  //
  // It is loaded on demand so that diners — who are most of the traffic and
  // will never sign in — do not pay 56 KB for it. But somebody looking at this
  // screen is about to sign in, so waiting until they press the button just
  // moves the delay to the moment they are watching. Fire and forget: a failure
  // here is retried by the click, which handles it.
  useEffect(() => {
    if (authConfigured) getSupabase();
  }, []);

  /**
   * Where to land after the link is clicked.
   *
   * AuthContext.navigateToLogin puts the page they were trying to reach in
   * ?next=, so somebody who clicked through to the dashboard comes back to the
   * dashboard rather than the home page.
   *
   * Same-origin only: `next` arrives from the URL, and passing it through
   * unchecked would make this an open redirect — a link that starts on
   * billtap.app and lands on somebody else's login form is a credible phishing
   * page. `//evil.com` is the case that catches people: it starts with a slash
   * and is still absolute.
   */
  const redirectTo = () => {
    const raw = new URLSearchParams(window.location.search).get("next") || "/home";
    const path = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/home";
    return `${window.location.origin}${path}`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const client = await getSupabase();
      if (!client) throw new Error('auth unavailable');
      const { error: sendError } = await client.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: redirectTo() },
      });
      if (sendError) throw sendError;
      setSent(true);
    } catch {
      // Deliberately not "no account with that email". This endpoint would
      // otherwise answer whether any given address has an account here, to
      // anybody who cares to ask.
      setError("Could not send that link. Check the address and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    try {
      const client = await getSupabase();
      if (!client) throw new Error('auth unavailable');
      const { error: oauthError } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectTo() },
      });
      if (oauthError) throw oauthError;
    } catch {
      setError("Could not start Google sign-in. Try the email link instead.");
    }
  };

  if (!authConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#0a0e1a" }}>
        <div className="w-full max-w-sm rounded-2xl p-8 text-center" style={{ background: "#111827", border: "1px solid #2d3748" }}>
          <h1 className="text-xl font-bold text-white mb-2">Sign-in is not available</h1>
          <p className="text-sm" style={{ color: "#8b90a8" }}>
            This build has no authentication configured. Splitting a bill still works —
            it never needed an account.
          </p>
          <Link to="/" className="inline-block mt-6 text-sm font-semibold" style={{ color: "#00c896" }}>
            Back to BillTap
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#0a0e1a" }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#00c896" }}>
            <QrCode className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold" style={{ color: "#00c896" }}>BillTap</span>
        </div>

        <div className="rounded-2xl p-8" style={{ background: "#111827", border: "1px solid #2d3748" }}>
          {sent ? (
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "#1e2533" }}>
                <Mail className="w-6 h-6" style={{ color: "#00c896" }} aria-hidden="true" />
              </div>
              <h1 className="text-2xl font-bold text-white">Check your email</h1>
              <p className="text-sm leading-relaxed" style={{ color: "#8b90a8" }}>
                If <span style={{ color: "#f2f2f4" }}>{email.trim().toLowerCase()}</span> has a BillTap
                account, a sign-in link is on its way. It expires shortly, so use it soon.
              </p>
              <p className="text-sm leading-relaxed" style={{ color: "#8b90a8" }}>
                Open it on this device — the link signs in whichever browser opens it.
              </p>
              <button
                type="button"
                onClick={() => { setSent(false); setError(""); }}
                className="text-sm font-semibold"
                style={{ color: "#00c896" }}
              >
                Use a different address
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-white mb-1">Welcome back</h1>
              <p className="text-sm mb-6" style={{ color: "#8b90a8" }}>
                No password needed — we&apos;ll email you a link.
              </p>

              <button
                onClick={handleGoogle}
                className="w-full h-11 rounded-xl font-semibold text-sm mb-4 flex items-center justify-center gap-2 transition-all hover:opacity-90"
                style={{ background: "#1e2533", border: "1px solid #2d3748", color: "#f2f2f4" }}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>
                Continue with Google
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px" style={{ background: "#2d3748" }} />
                <span className="text-xs" style={{ color: "#4a5068" }}>or</span>
                <div className="flex-1 h-px" style={{ background: "#2d3748" }} />
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium mb-1.5" style={{ color: "#f2f2f4" }}>Email</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full h-11 rounded-xl px-4 text-sm outline-none"
                    style={{ background: "#1e2533", border: "1px solid #2d3748", color: "#f2f2f4" }}
                    placeholder="you@example.com"
                  />
                </div>
                {error && <p className="text-sm" style={{ color: "#f87171" }} role="alert">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-xl font-bold text-sm transition-all hover:opacity-90 disabled:opacity-60"
                  style={{ background: "#00c896", color: "#0a0e1a" }}
                >
                  {loading ? "Sending…" : "Email me a sign-in link"}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-sm mt-6" style={{ color: "#8b90a8" }}>
          Splitting a bill never needs an account.{" "}
          <Link to="/" style={{ color: "#00c896" }} className="font-semibold">Start a split</Link>
        </p>
      </div>
    </div>
  );
}

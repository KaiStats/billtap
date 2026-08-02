import { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { QrCode } from "lucide-react";

/**
 * /forgot-password
 *
 * Login.jsx has linked here since it was written. The page did not exist, so
 * anyone who forgot their password got a 404 — the Worker returns a real one
 * for unknown routes now, which at least made it visible rather than silently
 * serving the SPA shell.
 *
 * The SDK had the whole flow the entire time: resetPasswordRequest sends the
 * email, resetPassword redeems the token. Both go through the same
 * /api/apps/<id>/... proxy as everything else.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  /**
   * The answer is the same either way.
   *
   * Saying "no account with that email" turns this box into a tool for finding
   * out who has an account, one address at a time. Success and failure both
   * land on the same screen, and a real failure is logged rather than shown.
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await base44.auth.resetPasswordRequest(email.trim().toLowerCase());
    } catch {
      /* Deliberately indistinguishable from success. */
    } finally {
      setLoading(false);
      setSent(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#0a0e1a" }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#00c896" }}>
            <QrCode className="w-6 h-6 text-white" aria-hidden="true" />
          </div>
          <span className="text-2xl font-bold" style={{ color: "#00c896" }}>BillTap</span>
        </div>

        <div className="rounded-2xl p-8" style={{ background: "#111827", border: "1px solid #2d3748" }}>
          {sent ? (
            <div className="space-y-4">
              <h1 className="text-2xl font-bold text-white">Check your email</h1>
              <p className="text-sm leading-relaxed" style={{ color: "#8b90a8" }}>
                If <span style={{ color: "#f2f2f4" }}>{email.trim().toLowerCase()}</span> has a BillTap
                account, a link to set a new password is on its way. It expires shortly, so use it soon.
              </p>
              <p className="text-sm leading-relaxed" style={{ color: "#8b90a8" }}>
                Nothing arriving? Check spam. If you signed up with Google there is no password to
                reset — use <span style={{ color: "#f2f2f4" }}>Continue with Google</span> on the sign-in page.
              </p>
              <div className="flex gap-3 pt-1">
                <Link
                  to="/login"
                  className="flex-1 h-11 rounded-xl font-bold text-sm flex items-center justify-center transition-all hover:opacity-90"
                  style={{ background: "#00c896", color: "#0a0e1a" }}
                >
                  Back to sign in
                </Link>
                <button
                  onClick={() => setSent(false)}
                  className="h-11 px-4 rounded-xl font-semibold text-sm transition-all hover:opacity-90"
                  style={{ background: "#1e2533", border: "1px solid #2d3748", color: "#f2f2f4" }}
                >
                  Try another email
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-white mb-1">Forgot your password?</h1>
              <p className="text-sm mb-6" style={{ color: "#8b90a8" }}>
                Enter your email and we&apos;ll send you a link to set a new one.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium mb-1.5" style={{ color: "#f2f2f4" }}>Email</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-11 rounded-xl px-4 text-sm outline-none"
                    style={{ background: "#1e2533", border: "1px solid #2d3748", color: "#f2f2f4" }}
                    placeholder="you@example.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-xl font-bold text-sm transition-all hover:opacity-90 disabled:opacity-60"
                  style={{ background: "#00c896", color: "#0a0e1a" }}
                >
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-sm mt-6" style={{ color: "#8b90a8" }}>
          Remembered it?{" "}
          <Link to="/login" style={{ color: "#00c896" }} className="font-semibold">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

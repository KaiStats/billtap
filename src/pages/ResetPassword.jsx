import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { QrCode } from "lucide-react";

/**
 * The token that arrives in the reset email.
 *
 * Read liberally on purpose. The link is composed by Base44, not by this app,
 * so the parameter name is not ours to decide and getting it wrong means the
 * page tells someone holding a perfectly good link that it is invalid. Every
 * spelling anyone uses is accepted, and the hash is checked too, because some
 * providers put the token there to keep it out of the Referer header.
 */
function readToken() {
  const names = ["token", "reset_token", "resetToken", "t", "code"];
  const query = new URLSearchParams(window.location.search);
  for (const name of names) {
    const value = query.get(name);
    if (value) return value;
  }
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  for (const name of names) {
    const value = hash.get(name);
    if (value) return value;
  }
  return null;
}

const MIN_LENGTH = 8;

export default function ResetPassword() {
  const navigate = useNavigate();
  const token = useMemo(readToken, []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    // Checked before the request, because a typo confirmed by the server is a
    // password nobody knows and a second trip through the email.
    if (password !== confirm) {
      setError("Those two passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await base44.auth.resetPassword({ resetToken: token, newPassword: password });
      setDone(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch {
      setError("That link has expired or has already been used. Request a new one.");
    } finally {
      setLoading(false);
    }
  };

  const shell = (children) => (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#0a0e1a" }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#00c896" }}>
            <QrCode className="w-6 h-6 text-white" aria-hidden="true" />
          </div>
          <span className="text-2xl font-bold" style={{ color: "#00c896" }}>BillTap</span>
        </div>
        <div className="rounded-2xl p-8" style={{ background: "#111827", border: "1px solid #2d3748" }}>
          {children}
        </div>
      </div>
    </div>
  );

  // Someone landed here without a token — an old bookmark, or a link their mail
  // client mangled. Send them somewhere useful instead of an empty form.
  if (!token) {
    return shell(
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-white">This link is incomplete</h1>
        <p className="text-sm leading-relaxed" style={{ color: "#8b90a8" }}>
          Password reset links carry a one-time code, and this one arrived without it. Ask for a
          fresh link and open it directly from the email.
        </p>
        <Link
          to="/forgot-password"
          className="w-full h-11 rounded-xl font-bold text-sm flex items-center justify-center transition-all hover:opacity-90"
          style={{ background: "#00c896", color: "#0a0e1a" }}
        >
          Send a new link
        </Link>
      </div>,
    );
  }

  if (done) {
    return shell(
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-white">Password changed</h1>
        <p className="text-sm leading-relaxed" style={{ color: "#8b90a8" }}>
          You can sign in with it now. Taking you to the sign-in page.
        </p>
        <Link
          to="/login"
          className="w-full h-11 rounded-xl font-bold text-sm flex items-center justify-center transition-all hover:opacity-90"
          style={{ background: "#00c896", color: "#0a0e1a" }}
        >
          Sign in
        </Link>
      </div>,
    );
  }

  return shell(
    <>
      <h1 className="text-2xl font-bold text-white mb-1">Set a new password</h1>
      <p className="text-sm mb-6" style={{ color: "#8b90a8" }}>Choose something you have not used here before.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1.5" style={{ color: "#f2f2f4" }}>New password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-11 rounded-xl px-4 text-sm outline-none"
            style={{ background: "#1e2533", border: "1px solid #2d3748", color: "#f2f2f4" }}
            placeholder={`At least ${MIN_LENGTH} characters`}
          />
        </div>
        <div>
          <label htmlFor="confirm" className="block text-sm font-medium mb-1.5" style={{ color: "#f2f2f4" }}>Confirm password</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full h-11 rounded-xl px-4 text-sm outline-none"
            style={{ background: "#1e2533", border: "1px solid #2d3748", color: "#f2f2f4" }}
            placeholder="Type it again"
          />
        </div>
        {error && <p className="text-sm" style={{ color: "#f87171" }} role="alert">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 rounded-xl font-bold text-sm transition-all hover:opacity-90 disabled:opacity-60"
          style={{ background: "#00c896", color: "#0a0e1a" }}
        >
          {loading ? "Saving…" : "Save new password"}
        </button>
      </form>
    </>,
  );
}

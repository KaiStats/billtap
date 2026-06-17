import { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { QrCode } from "lucide-react";

export default function Register() {
  const [step, setStep] = useState("register"); // "register" | "otp"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    try {
      await base44.auth.register({ email, password });
      setStep("otp");
    } catch (err) {
      setError(err?.data?.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { access_token } = await base44.auth.verifyOtp({ email, otpCode: otp });
      base44.auth.setToken(access_token);
      window.location.href = "/home";
    } catch (err) {
      setError("Invalid or expired code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try { await base44.auth.resendOtp(email); } catch {}
  };

  const handleGoogle = () => {
    base44.auth.loginWithProvider("google", "/home");
  };

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
          {step === "register" ? (
            <>
              <h1 className="text-2xl font-bold text-white mb-1">Create account</h1>
              <p className="text-sm mb-6" style={{ color: "#8b90a8" }}>Free forever. No credit card needed.</p>

              <button
                onClick={handleGoogle}
                className="w-full h-11 rounded-xl font-semibold text-sm mb-4 flex items-center justify-center gap-2 transition-all hover:opacity-90"
                style={{ background: "#1e2533", border: "1px solid #2d3748", color: "#f2f2f4" }}
              >
                <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>
                Continue with Google
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px" style={{ background: "#2d3748" }} />
                <span className="text-xs" style={{ color: "#4a5068" }}>or</span>
                <div className="flex-1 h-px" style={{ background: "#2d3748" }} />
              </div>

              <form onSubmit={handleRegister} className="space-y-4">
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
                <div>
                  <label htmlFor="password" className="block text-sm font-medium mb-1.5" style={{ color: "#f2f2f4" }}>Password</label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full h-11 rounded-xl px-4 text-sm outline-none"
                    style={{ background: "#1e2533", border: "1px solid #2d3748", color: "#f2f2f4" }}
                    placeholder="Min. 8 characters"
                  />
                </div>
                <div>
                  <label htmlFor="confirm" className="block text-sm font-medium mb-1.5" style={{ color: "#f2f2f4" }}>Confirm Password</label>
                  <input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    className="w-full h-11 rounded-xl px-4 text-sm outline-none"
                    style={{ background: "#1e2533", border: "1px solid #2d3748", color: "#f2f2f4" }}
                    placeholder="Re-enter password"
                  />
                </div>
                {error && <p className="text-sm" style={{ color: "#f87171" }} role="alert">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-xl font-bold text-sm transition-all hover:opacity-90 disabled:opacity-60"
                  style={{ background: "#00c896", color: "#0a0e1a" }}
                >
                  {loading ? "Creating account..." : "Create Account"}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-white mb-1">Check your email</h1>
              <p className="text-sm mb-6" style={{ color: "#8b90a8" }}>
                We sent a verification code to <span style={{ color: "#f2f2f4" }}>{email}</span>
              </p>
              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label htmlFor="otp" className="block text-sm font-medium mb-1.5" style={{ color: "#f2f2f4" }}>Verification Code</label>
                  <input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-full h-11 rounded-xl px-4 text-sm outline-none text-center tracking-widest text-lg font-bold"
                    style={{ background: "#1e2533", border: "1px solid #2d3748", color: "#f2f2f4" }}
                    placeholder="000000"
                  />
                </div>
                {error && <p className="text-sm" style={{ color: "#f87171" }} role="alert">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-xl font-bold text-sm transition-all hover:opacity-90 disabled:opacity-60"
                  style={{ background: "#00c896", color: "#0a0e1a" }}
                >
                  {loading ? "Verifying..." : "Verify & Sign In"}
                </button>
              </form>
              <button onClick={handleResend} className="w-full mt-3 text-sm" style={{ color: "#8b90a8" }}>
                Didn't get a code? <span style={{ color: "#00c896" }}>Resend</span>
              </button>
            </>
          )}
        </div>

        <p className="text-center text-sm mt-6" style={{ color: "#8b90a8" }}>
          Already have an account?{" "}
          <Link to="/login" style={{ color: "#00c896" }} className="font-semibold">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
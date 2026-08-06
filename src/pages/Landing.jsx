import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, QrCode, Camera, Users, Shield, Smartphone, CreditCard, Zap, FileText, Lock } from "lucide-react";
import Seo from "@/components/Seo";
import { art, artSrcSet, artSizes, video, videoPoster, VIDEO_MANIFEST } from "@/lib/landing-assets";

/**
 * The product demo, framed as a phone because the clip is 9:16.
 *
 * Autoplay is muted and inline or mobile browsers refuse it outright. It is
 * also silent by design: the render carries an audio track, but a landing page
 * that makes noise on arrival is a page people close.
 *
 * `preload="none"` keeps ten seconds of 720p off the critical path. The poster
 * is the still the clip was generated from — already on the page as step-photo —
 * so a real frame paints immediately and the video streams in behind it.
 *
 * Under prefers-reduced-motion nothing plays on its own: the poster stands and
 * the controls appear, so the demo stays reachable by anyone who wants it.
 */
/** @param {{ name?: any, className?: any, [key: string]: any }} props */
function DemoVideo({ name, className = "" }) {
  const [reduced, setReduced] = useState(false);
  const src = video(name);
  const entry = VIDEO_MANIFEST[name];

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (!src || !entry) return null;

  return (
    <video
      className={className}
      style={{ aspectRatio: entry.aspect, width: "100%", display: "block", objectFit: "cover" }}
      src={src}
      poster={videoPoster(name) || undefined}
      autoPlay={!reduced}
      loop={!reduced}
      muted
      playsInline
      controls={reduced}
      preload="none"
      aria-label="Ten-second demo: a phone scans a paper receipt, the items light up one by one, a QR code appears, friends' phones check off what they ordered, and the payment confirms."
    />
  );
}

/**
 * Content image that fades up once decoded and removes itself on error, so the
 * gradient underneath becomes the design rather than a broken box.
 */
/** @param {{ name?: any, alt?: any, className?: any, to?: any, eager?: any, position?: any, [key: string]: any }} props */
function Img({ name, alt, className = "", to = 1, eager = false, position = "center" }) {
  const [loaded, setLoaded] = useState(false);
  const src = art(name);
  if (!src) return null;
  return (
    <img
      src={src}
      // Both null until the art is self-hosted — the CDN holds only the one
      // full-size original, so a single-entry srcset would be noise. After
      // scripts/fetch-art.mjs runs, the browser picks the smallest file
      // that covers the slot instead of a 2400px PNG for a 290px card.
      srcSet={artSrcSet(name) || undefined}
      sizes={artSizes(name) || undefined}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "low"}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={(e) => { e.currentTarget.style.display = "none"; }}
      className={`lp-img ${loaded ? "is-loaded" : ""} ${className}`}
      style={/** @type {any} */ ({ "--to": to, objectPosition: position })}
    />
  );
}

/**
 * Decorative section wash. Purely presentational, so it is aria-hidden and its
 * opacity is baked into CSS rather than gated on a load event — a background
 * that fades in after the copy has already painted reads as a glitch.
 */
/** @param {{ name?: any, opacity?: any, position?: any, className?: any, eager?: any, [key: string]: any }} props */
function Wash({ name, opacity = 0.14, position = "center", className = "", eager = false }) {
  const src = art(name);
  if (!src) return null;
  return (
    <img
      src={src}
      srcSet={artSrcSet(name) || undefined}
      sizes={artSizes(name) || undefined}
      alt=""
      aria-hidden="true"
      // The hero wash is above the fold: lazy-loading it would leave the first
      // screen flat until after layout. Every other wash is below it.
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "low"}
      decoding="async"
      onError={(e) => { e.currentTarget.style.display = "none"; }}
      className={`lp-wash ${className}`}
      style={{ opacity, objectPosition: position }}
    />
  );
}

/**
 * The BillTap mark. Falls back to the lucide glyph if the render fails to load,
 * because a nav with no logo at all is worse than a generic one.
 */
/** @param {{ size?: any, [key: string]: any }} props */
function Logo({ size = 32 }) {
  const [failed, setFailed] = useState(false);
  const src = art("logo");
  if (!src || failed) {
    return (
      <div
        className="rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: "#00c896", width: size, height: size }}
      >
        <QrCode className="text-white" style={{ width: size * 0.62, height: size * 0.62 }} />
      </div>
    );
  }
  return (
    <img
      src={src}
      srcSet={artSrcSet("logo") || undefined}
      sizes={artSizes("logo") || undefined}
      alt="BillTap"
      width={size}
      height={size}
      decoding="async"
      onError={() => setFailed(true)}
      className="rounded-lg flex-shrink-0 object-cover"
      style={{ width: size, height: size }}
    />
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistStatus, setWaitlistStatus] = useState(null); // null | "loading" | "done" | "error"

  /**
   * Straight to the split.
   *
   * This used to ask whether the visitor was signed in and send everyone else
   * to /register. Nobody needs an account to split a bill — that is the product
   * — so the check could only ever put a sign-up form between somebody and the
   * thing they came to do, and it cost a round trip to do it.
   */
  const handleSplitNow = () => {
    navigate("/new-receipt");
  };

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Fire PackagePicker Meta Pixel event once when pricing enters view
  useEffect(() => {
    const pricingEl = document.getElementById("pricing");
    if (!pricingEl || typeof window.fbq !== "function") return;
    let fired = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !fired) {
        fired = true;
        window.fbq("trackCustom", "PackagePicker");
        observer.disconnect();
      }
    }, { threshold: 0.3 });
    observer.observe(pricingEl);
    return () => observer.disconnect();
  }, []);

  /**
   * The waitlist capture, which currently has nowhere to put an email.
   *
   * It wrote a Waitlist row through the Base44 SDK and there is no endpoint on
   * the Worker that accepts one — /api/restaurant-lead is for operators and
   * requires a restaurant name, so it is not this. Since operators moved to
   * Supabase there has been no Base44 session either, which means this has been
   * failing for every visitor already; removing the SDK does not break it, it
   * makes the breakage legible.
   *
   * Reporting the failure rather than showing "you're on the list" is the
   * deliberate half. Silently accepting an address nothing records tells a real
   * person they will hear from us when nobody will, and the error copy below
   * gives them the phone number instead.
   *
   * To restore it: a POST /api/waitlist on the Worker, shaped like
   * routes/restaurant-lead.js — honeypot, size cap, and the notification
   * through lib/email.js. Not added here because a public email-sending
   * endpoint is its own change with its own abuse surface, and this commit is
   * meant to only remove things.
   */
  const handleWaitlist = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const email = waitlistEmail.trim();
    if (!emailRegex.test(email)) return;

    setWaitlistStatus("loading");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // company_website is the honeypot the endpoint checks. Empty from a
        // real browser; a bot that fills every field it finds is accepted and
        // discarded without being told it was caught.
        body: JSON.stringify({ email, source: "landing", company_website: "" }),
      });
      // The endpoint answers 502 only when nothing was stored AND nothing was
      // sent, so res.ok genuinely means somebody has this address.
      if (!res.ok) throw new Error(`waitlist responded ${res.status}`);
      setWaitlistStatus("done");
    } catch {
      setWaitlistStatus("error");
    }
  };

  const steps = [
    { img: "step-photo", alt: "A restaurant table seen from above, hands reaching toward a phone that reads the paper check.", title: "Photo the Bill", desc: "Host photographs the receipt. AI reads every item instantly. No typing." },
    { img: "step-share", alt: "A phone floating against dark space, its screen filled with a glowing QR code.", title: "Share the QR", desc: "A unique QR code appears. Everyone scans it. No app download. No account needed." },
    { img: "step-claim", alt: "Phones arranged in a circle, each screen showing a claimed item marked with a check.", title: "Claim Your Items", desc: "Each person claims what they ordered. Tax and tip split proportionally." },
    { img: "step-pay", alt: "A phone screen showing a payment confirmed, coins drifting upward from it.", title: "Pay in One Tap", desc: "Venmo, Cash App, or Zelle. One tap. Host sees paid/unpaid in real time." },
  ];

  const splitModes = [
    { img: "mode-even", alt: "A receipt divided into equal glowing slices, like a pie chart.", title: "Even Split", desc: "Everyone pays the same. Auto-divides as guests join.", borderStyle: "4px solid #00c896" },
    { img: "mode-itemized", alt: "A receipt with individual line items lit up separately, each floating above the paper.", title: "Itemized Split", desc: "Claim exactly what you ordered. Tax and tip prorated automatically.", borderStyle: "4px solid #60a5fa" },
    { img: "mode-custom", alt: "Adjustable percentage sliders and segments arranged on a grid.", title: "Custom Split", desc: "Percentage, fixed amounts, or shares. You control who pays what.", borderStyle: "4px solid #d4af37" },
  ];

  const features = [
    { icon: Camera, title: "AI Receipt Scanning", desc: "Photo the bill. AI reads every item." },
    { icon: Lock, title: "Secure QR Tokens", desc: "HMAC-signed. Refreshes every 25 min." },
    { icon: Users, title: "Guest Access", desc: "Scan and join. No download needed." },
    { icon: Zap, title: "Real-Time Tracking", desc: "See who's paid and who hasn't. Live." },
    { icon: CreditCard, title: "One-Tap Payment", desc: "Venmo, Cash App, or Zelle. Done." },
    // "Always on record" implied a vault this product does not have. A guest
    // has no account, so their history is the index kept on their own phone —
    // which is now true, where before this line described nothing at all.
    { icon: FileText, title: "Bill History", desc: "Every split you've been in. Kept on your phone." },
  ];

  const stats = [
    { value: "0", label: "Accounts needed to split" },
    { value: "3", label: "Payment apps supported" },
    { value: "25min", label: "QR security refresh" },
    { value: "Live", label: "Built in public" },
  ];

  const trustBadges = [
    { icon: Users, text: "Guest Access — No signup to join" },
    { icon: Lock, text: "HMAC Signed — Cryptographic QR tokens" },
    { icon: Shield, text: "Payment Ready — Venmo, Cash App, and Zelle" },
    { icon: FileText, text: "Zero Data Sold — Your splits stay private" },
    { icon: Smartphone, text: "Venmo/Cash App/Zelle — US payment stack" },
    { icon: Zap, text: "Built in Public — No hidden roadmap" },
  ];

  const freeFeatures = [
    "Unlimited bill splits",
    "All 3 split modes",
    "QR code generation",
    "AI receipt scanning",
    "Up to 10 people per session",
    "Basic settlement via payment links",
    "Venmo/Cash App/Zelle",
    "Guest access (no account)",
  ];

  const proFeatures = [
    "Everything in Free",
    "Unlimited party size",
    "Expense categories",
    "Recurring bills (rent, utilities, subscriptions)",
    "Payout directly to bank account",
  ];

  return (
    <div className="min-h-screen font-body" style={{ background: "#0a0e1a", color: "#f2f2f4" }}>
      <Seo
        path="/"
        title="BillTap — Split the Bill in 30 Seconds, No App"
        description="Scan the receipt, share a QR code, everyone claims their items and pays their exact share. No app, no accounts, no math, no IOUs."
      />
      <style>{`
        .font-heading { font-family: 'Space Grotesk', sans-serif; }
        .font-body { font-family: 'Inter', sans-serif; }

        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes pulse-circle {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(1.04); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-16px); }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .shimmer-text {
          background: linear-gradient(90deg, #00c896 0%, #00ffcc 50%, #00c896 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 5s linear infinite;
        }
        .dot-grid {
          background-image: radial-gradient(circle, rgba(0,200,150,0.12) 1px, transparent 1px);
          background-size: 28px 28px;
        }
        .glass-nav {
          background: rgba(10,14,26,0.85);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(45,55,72,0.6);
        }
        .card-hover {
          transition: transform 0.25s ease, box-shadow 0.25s ease;
        }
        .card-hover:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 48px rgba(0,200,150,0.12);
        }
        .qr-pulse {
          animation: pulse-circle 3s ease-in-out infinite;
        }
        .floating {
          animation: float 6s ease-in-out infinite;
        }
        /* ── Art ──────────────────────────────────────────────────────────
           The renders are 3D product illustration on the same deep navy the
           page already uses, so they composite into the sections rather than
           sitting on top of them as photographs would. */
        .lp-img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          opacity: 0;
          transition: opacity 0.5s ease;
        }
        .lp-img.is-loaded { opacity: var(--to, 1); }

        .lp-wash {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          pointer-events: none;
          user-select: none;
        }
        /* Every wash carries a scrim above it so body copy keeps its contrast
           no matter how bright a patch of the render lands behind it. */
        .lp-scrim { position: absolute; inset: 0; pointer-events: none; }

        /* Card media band. The aspect ratio is fixed so a row of cards stays on
           a baseline whether or not the art has arrived. */
        .lp-media {
          position: relative;
          aspect-ratio: 16 / 10;
          overflow: hidden;
          background: linear-gradient(135deg, rgba(0,200,150,0.12) 0%, rgba(10,14,26,0.9) 70%);
        }

        @media (prefers-reduced-motion: reduce) {
          .lp-img { transition: none; }
          .floating, .qr-pulse { animation: none; }
        }

        .hero-text-1 { animation: fade-up 0.6s ease both; }
        .hero-text-2 { animation: fade-up 0.6s ease 0.1s both; }
        .hero-text-3 { animation: fade-up 0.6s ease 0.2s both; }
        .hero-text-4 { animation: fade-up 0.6s ease 0.35s both; }
        .hero-text-5 { animation: fade-up 0.6s ease 0.5s both; }
      `}</style>

      {/* ── STICKY NAV ── */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "glass-nav" : "bg-transparent"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 md:h-20">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <Logo size={32} />
              <span className="font-heading font-bold text-lg" style={{ color: "#00c896" }}>BillTap</span>
            </div>

            {/* Center links */}
            <div className="hidden md:flex items-center gap-8">
              {[{ label: "How It Works", href: "#how-it-works" }, { label: "Pricing", href: "#pricing" }, { label: "Security", href: "#security" }].map(l => (
                <a key={l.label} href={l.href} className="text-sm font-medium transition-colors hover:text-green-400" style={{ color: "#8b90a8" }}>{l.label}</a>
              ))}
            </div>

            {/* Right CTAs */}
            <div className="flex items-center gap-3">
              <Link to="/login" className="text-sm font-medium transition-colors hover:text-green-400 hidden sm:block" style={{ color: "#8b90a8" }}>Sign in</Link>
              <Link to="/register" className="px-4 py-2 rounded-lg font-semibold text-sm transition-all hover:opacity-90" style={{ background: "#00c896", color: "#0a0e1a" }}>
                Start Free
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative min-h-[100dvh] flex items-center pt-16 overflow-hidden dot-grid">
        {/* Full-bleed art, then the dot grid and glows on top of it. The scrim
            is heavy on the left because that is where the H1 and subhead sit —
            the copy has to stay legible over whatever the render does there. */}
        <div className="absolute inset-0 pointer-events-none">
          <Wash name="hero" opacity={0.5} eager />
          <div className="lp-scrim" style={{ background: "linear-gradient(90deg, rgba(10,14,26,0.96) 0%, rgba(10,14,26,0.86) 45%, rgba(10,14,26,0.6) 100%)" }} />
          <div className="lp-scrim" style={{ background: "linear-gradient(180deg, rgba(10,14,26,0.85) 0%, transparent 30%, transparent 65%, #0a0e1a 100%)" }} />
          <div className="qr-pulse absolute" style={{ top: "20%", left: "50%", transform: "translateX(-50%)", width: "min(80vw, 600px)", height: "min(80vw, 600px)", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,200,150,0.08) 0%, transparent 70%)" }} />
          <div className="qr-pulse absolute" style={{ top: "15%", left: "50%", transform: "translateX(-50%)", width: "min(60vw, 450px)", height: "min(60vw, 450px)", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,200,150,0.06) 0%, transparent 70%)", animationDelay: "1s" }} />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24 w-full">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Copy */}
            <div className="space-y-6 md:space-y-8">
              {/* Badge */}
              <div className="hero-text-1 inline-flex items-center gap-2 px-4 py-2 rounded-full border" style={{ borderColor: "#2d3748", background: "rgba(17,24,39,0.6)" }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#00c896", boxShadow: "0 0 6px #00c896" }} />
                <span className="text-xs sm:text-sm font-medium" style={{ color: "#8b90a8" }}>AI-Powered · No Account Needed · US Only</span>
              </div>

              {/* H1 */}
              <h1 className="hero-text-2 font-heading font-bold text-5xl sm:text-6xl lg:text-7xl leading-tight">
                <span style={{ color: "#f2f2f4" }}>Scan. Split.</span>
                <br />
                <span className="shimmer-text">Settled.</span>
              </h1>

              {/* Subhead */}
              <p className="hero-text-3 text-base md:text-lg lg:text-xl leading-relaxed max-w-xl" style={{ color: "#8b90a8" }}>
                Photograph the bill. Everyone scans the QR. Claim your items. Pay in one tap.<br className="hidden md:block" />
                No math. No awkwardness. No chasing anyone.
              </p>

              {/* CTAs */}
              <div className="hero-text-4 flex flex-col sm:flex-row gap-4">
                <button
                  onClick={handleSplitNow}
                  className="px-8 py-4 rounded-xl font-bold text-base md:text-lg transition-all hover:opacity-90 text-center"
                  style={{ background: "#00c896", color: "#0a0e1a" }}
                >
                  Split a Bill Now →
                </button>
                <a href="#how-it-works" className="px-8 py-4 rounded-xl font-semibold text-base md:text-lg border transition-all hover:border-green-400 text-center" style={{ borderColor: "#2d3748", color: "#f2f2f4" }}>
                  See How It Works
                </a>
              </div>

              {/* Launch strip */}
              <div className="hero-text-5 flex flex-wrap items-center gap-3 pt-2">
                {["Now Live", "Built in Public", "Free Forever", "US Only"].map((tag, i) => (
                  <span key={tag} className="text-xs font-medium px-3 py-1.5 rounded-full" style={{ background: i === 0 ? "rgba(0,200,150,0.12)" : "rgba(139,144,168,0.1)", color: i === 0 ? "#00c896" : "#8b90a8" }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Right: Phone mockup */}
            <div className="hidden lg:flex items-center justify-center">
              <div className="relative floating">
                <div className="qr-pulse absolute -inset-8 rounded-3xl" style={{ background: "radial-gradient(circle, rgba(0,200,150,0.2) 0%, transparent 70%)" }} />
                <div className="relative rounded-3xl p-8 border shadow-2xl" style={{ background: "#111827", borderColor: "#2d3748", minWidth: 280 }}>
                  {/* Phone top bar */}
                  <div className="flex items-center gap-2 mb-6">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#ff5f57" }} />
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#febc2e" }} />
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#28c840" }} />
                    <span className="ml-auto text-xs" style={{ color: "#8b90a8" }}>billtap.app/claim</span>
                  </div>
                  {/* QR box */}
                  <div className="aspect-square w-48 mx-auto rounded-2xl flex items-center justify-center mb-5" style={{ background: "#0a0e1a", border: "2px solid rgba(0,200,150,0.3)" }}>
                    <QrCode className="w-32 h-32" style={{ color: "#00c896" }} />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="font-heading font-bold" style={{ color: "#f2f2f4" }}>Scan to Join Split</p>
                    <p className="text-xs" style={{ color: "#8b90a8" }}>Table for 6 · $147.40</p>
                    <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-xs font-medium" style={{ background: "rgba(0,200,150,0.1)", color: "#00c896" }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#00c896" }} />
                      4 of 6 claimed
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="relative py-16 md:py-24 overflow-hidden" style={{ background: "#111827" }}>
        <Wash name="band-steps" opacity={0.16} />
        <div className="lp-scrim" style={{ background: "linear-gradient(180deg, #111827 0%, rgba(17,24,39,0.72) 35%, rgba(17,24,39,0.72) 65%, #111827 100%)" }} />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-4" style={{ color: "#f2f2f4" }}>How It Works</h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto" style={{ color: "#8b90a8" }}>Four steps to split any bill. No math required.</p>
          </div>

          {/* The whole flow in ten seconds, above the four steps that describe
              it. Phone-framed because the clip is 9:16, and capped narrow so it
              introduces the section rather than swallowing it. */}
          <div className="flex justify-center mb-12 md:mb-16">
            <div className="relative floating" style={{ width: "min(72vw, 260px)" }}>
              <div className="qr-pulse absolute -inset-6 rounded-3xl" style={{ background: "radial-gradient(circle, rgba(0,200,150,0.18) 0%, transparent 70%)" }} />
              <div className="relative rounded-3xl p-2.5 border shadow-2xl" style={{ background: "#111827", borderColor: "#2d3748" }}>
                <DemoVideo name="product-demo" className="rounded-2xl" />
              </div>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((step, idx) => (
              <div key={idx} className="card-hover rounded-2xl border relative overflow-hidden" style={{ background: "#1e2533", borderColor: "#2d3748" }}>
                <div className="lp-media">
                  <Img name={step.img} alt={step.alt} />
                  {/* Fades the render into the card body so the media band
                      reads as part of the card rather than a pasted-in tile. */}
                  <div className="lp-scrim" style={{ background: "linear-gradient(180deg, transparent 45%, rgba(30,37,51,0.85) 85%, #1e2533 100%)" }} />
                  <div className="absolute top-3 right-3 text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(10,14,26,0.75)", color: "#00c896" }}>0{idx + 1}</div>
                </div>
                <div className="p-6 md:p-7 pt-4">
                  <h3 className="font-heading font-bold text-lg mb-2" style={{ color: "#f2f2f4" }}>{step.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "#8b90a8" }}>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SPLIT MODES ── */}
      <section className="py-16 md:py-24" style={{ background: "#0a0e1a" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-4" style={{ color: "#f2f2f4" }}>Three Ways to Split</h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto" style={{ color: "#8b90a8" }}>Choose the split mode that fits your group.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {splitModes.map((mode, idx) => (
              <div key={idx} className="card-hover rounded-2xl overflow-hidden" style={{ background: "#1e2533", border: "1px solid #2d3748", borderLeft: mode.borderStyle }}>
                <div className="lp-media" style={{ aspectRatio: "3 / 2" }}>
                  <Img name={mode.img} alt={mode.alt} />
                  <div className="lp-scrim" style={{ background: "linear-gradient(180deg, transparent 50%, rgba(30,37,51,0.85) 88%, #1e2533 100%)" }} />
                </div>
                <div className="p-8 pt-5">
                  <h3 className="font-heading font-bold text-xl mb-3" style={{ color: "#f2f2f4" }}>{mode.title}</h3>
                  <p className="text-base leading-relaxed" style={{ color: "#8b90a8" }}>{mode.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES GRID ── */}
      <section id="features" className="relative py-16 md:py-24 overflow-hidden" style={{ background: "#111827" }}>
        <Wash name="band-features" opacity={0.18} />
        <div className="lp-scrim" style={{ background: "linear-gradient(180deg, #111827 0%, rgba(17,24,39,0.7) 40%, rgba(17,24,39,0.7) 60%, #111827 100%)" }} />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-4" style={{ color: "#f2f2f4" }}>Built for Real Dinners</h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto" style={{ color: "#8b90a8" }}>Everything you need to split bills without the drama.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, idx) => (
              <div key={idx} className="card-hover p-6 md:p-8 rounded-2xl border" style={{ background: "#1e2533", borderColor: "#2d3748" }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ background: "rgba(0,200,150,0.1)" }}>
                  <feature.icon className="w-5 h-5" style={{ color: "#00c896" }} />
                </div>
                <h3 className="font-heading font-bold text-lg mb-2" style={{ color: "#f2f2f4" }}>{feature.title}</h3>
                <p className="text-sm" style={{ color: "#8b90a8" }}>{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="py-16 md:py-24" style={{ background: "#0a0e1a" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-4" style={{ color: "#f2f2f4" }}>Start free. Upgrade when you need more.</h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto" style={{ color: "#8b90a8" }}>
              Free gets most people everything they need. Pro unlocks when your use case gets serious.
            </p>
          </div>

          {/* Two-tier pricing grid */}
          <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {/* Free */}
            <div className="card-hover p-8 rounded-2xl border relative flex flex-col" style={{ background: "#1e2533", borderColor: "#2d3748" }}>
              <div className="mb-6">
                <p className="text-xs font-mono tracking-widest uppercase mb-1" style={{ color: "#8b90a8" }}>Free</p>
                <p className="text-sm mb-4" style={{ color: "#8b90a8" }}>For most dinners and group meals.</p>
                <span className="text-5xl font-black" style={{ color: "#f2f2f4" }}>$0</span>
                <span className="text-base ml-2" style={{ color: "#8b90a8" }}>/ forever</span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {freeFeatures.map(f => (
                  <li key={f} className="flex items-start gap-3">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#00c896" }} />
                    <span className="text-sm" style={{ color: "#f2f2f4" }}>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/register" className="block w-full py-3.5 rounded-xl font-bold text-sm text-center transition-all hover:opacity-90 border" style={{ borderColor: "#2d3748", color: "#f2f2f4" }}>
                Start Free
              </Link>
              <p className="text-center text-xs mt-3" style={{ color: "#4a5068" }}>No credit card · Always free</p>
            </div>

            {/* Pro */}
            <div className="card-hover p-8 rounded-2xl border-2 relative flex flex-col" style={{ background: "#1e2533", borderColor: "#00c896", boxShadow: "0 0 40px rgba(0,200,150,0.1)" }}>
              <div className="absolute -top-3.5 left-6 px-3 py-1 rounded-full text-xs font-bold" style={{ background: "#00c896", color: "#0a0e1a" }}>Most Popular</div>
              <div className="mb-6 pt-1">
                <p className="text-xs font-mono tracking-widest uppercase mb-1" style={{ color: "#00c896" }}>Pro</p>
                <p className="text-sm mb-4" style={{ color: "#8b90a8" }}>For bigger groups and recurring expenses.</p>
                <span className="text-5xl font-black" style={{ color: "#f2f2f4" }}>$4.99</span>
                <span className="text-base ml-2" style={{ color: "#8b90a8" }}>/ month</span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {proFeatures.map(f => (
                  <li key={f} className="flex items-start gap-3">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#00c896" }} />
                    <span className="text-sm" style={{ color: "#f2f2f4" }}>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/register" className="block w-full py-3.5 rounded-xl font-bold text-sm text-center transition-all hover:opacity-90" style={{ background: "#00c896", color: "#0a0e1a" }}>
                Start Pro Free Trial →
              </Link>
              <p className="text-center text-xs mt-3" style={{ color: "#4a5068" }}>14-day free trial · Then $4.99/mo</p>
            </div>
          </div>

          {/* Monetization trigger note */}
          <div className="max-w-2xl mx-auto mt-6 p-5 rounded-xl flex gap-4 items-start" style={{ background: "#1e2533", border: "1px solid #2d3748" }}>
            <span className="text-lg flex-shrink-0" aria-hidden="true">⚡</span>
            <p className="text-sm" style={{ color: "#8b90a8" }}>
              <span className="font-semibold" style={{ color: "#f2f2f4" }}>When does Pro kick in?</span> When you try to add an 11th person to a session, or set up a recurring bill, BillTap shows the upgrade prompt — right at the moment it's actually useful. No nag screens before then.
            </p>
          </div>

          {/* Waitlist card */}
          <div className="relative max-w-2xl mx-auto mt-10 p-6 rounded-2xl overflow-hidden" style={{ background: "#1e2533", border: "1px solid #2d3748", borderLeft: "4px solid #00c896" }}>
            <Wash name="celebrate" opacity={0.22} position="top" />
            <div className="lp-scrim" style={{ background: "linear-gradient(180deg, rgba(30,37,51,0.55) 0%, rgba(30,37,51,0.92) 55%, #1e2533 100%)" }} />
            <div className="relative">
            <h3 className="font-heading font-bold text-xl mb-2" style={{ color: "#f2f2f4" }}>Pro Features Coming Soon</h3>
            <p className="text-sm mb-5" style={{ color: "#8b90a8" }}>
              We're watching how people use BillTap. When we see what you actually need, we'll build it. Tell us what would make BillTap worth paying for.
            </p>
            {waitlistStatus === "done" ? (
              <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#00c896" }}>
                <Check className="w-4 h-4" /> You're on the list! We'll email you when Pro launches. No spam ever.
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <label htmlFor="waitlist-email" className="sr-only">Email address</label>
                  <input
                    id="waitlist-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={waitlistEmail}
                    onChange={e => setWaitlistEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleWaitlist()}
                    placeholder="your@email.com"
                    className="flex-1 h-11 rounded-xl border px-4 text-sm bg-transparent outline-none focus:border-green-500 transition-colors"
                    style={{ borderColor: "#2d3748", color: "#f2f2f4" }}
                  />
                  <button
                    onClick={handleWaitlist}
                    disabled={waitlistStatus === "loading"}
                    aria-busy={waitlistStatus === "loading"}
                    aria-label="Join the Pro waitlist"
                    className="px-5 h-11 rounded-xl font-semibold text-sm transition-all hover:opacity-90 whitespace-nowrap disabled:opacity-60"
                    style={{ background: "#00c896", color: "#0a0e1a" }}
                  >
                    {waitlistStatus === "loading" ? "..." : "Join the Waitlist →"}
                  </button>
                </div>
                {/* "Try again" would be a lie — nothing is recording these yet,
                    so a second attempt fails identically. */}
                {waitlistStatus === "error" && (
                  <p role="alert" className="text-xs mt-2" style={{ color: "#f87171" }}>
                    That didn&apos;t go through. Please try again, or email hello@billtap.app and we&apos;ll add you by hand.
                  </p>
                )}
                <p className="text-xs mt-3" style={{ color: "#4a5068" }}>No spam. One email when Pro launches. Unsubscribe anytime.</p>
              </>
            )}
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST SIGNALS ── */}
      <section id="security" className="relative py-16 md:py-24 overflow-hidden" style={{ background: "#111827" }}>
        <Wash name="band-stats" opacity={0.16} />
        <div className="lp-scrim" style={{ background: "linear-gradient(180deg, #111827 0%, rgba(17,24,39,0.74) 40%, rgba(17,24,39,0.74) 60%, #111827 100%)" }} />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="font-heading text-3xl md:text-4xl font-bold mb-4" style={{ color: "#f2f2f4" }}>By the Numbers</h2>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-12">
            {stats.map(stat => (
              <div key={stat.label} className="p-6 rounded-2xl border text-center" style={{ background: "#1e2533", borderColor: "#2d3748" }}>
                <div className="font-heading font-bold text-3xl md:text-4xl mb-2 shimmer-text">{stat.value}</div>
                <div className="text-xs md:text-sm" style={{ color: "#8b90a8" }}>{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Trust badges */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {trustBadges.map(badge => (
              <div key={badge.text} className="flex items-start gap-4 p-4 rounded-xl" style={{ background: "#1e2533", border: "1px solid #2d3748" }}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0,200,150,0.1)" }}>
                  <badge.icon className="w-5 h-5" style={{ color: "#00c896" }} />
                </div>
                <p className="text-sm pt-2" style={{ color: "#8b90a8" }}>{badge.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="relative py-16 md:py-24 overflow-hidden" style={{ background: "#0a0e1a" }}>
        <Wash name="band-cta" opacity={0.28} />
        <div className="lp-scrim" style={{ background: "radial-gradient(ellipse at center, rgba(10,14,26,0.55) 0%, rgba(10,14,26,0.9) 60%, #0a0e1a 100%)" }} />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-heading text-3xl md:text-5xl font-bold mb-6 leading-tight" style={{ color: "#f2f2f4" }}>
            The bill just came.
            <br />
            <span className="shimmer-text">Don't do the math.</span>
          </h2>
          <p className="text-lg md:text-xl mb-8 max-w-2xl mx-auto" style={{ color: "#8b90a8" }}>
            BillTap handles it. Scan, claim, pay. Built for real dinners with real friends. Free to start. No tricks.
          </p>
          <button
            onClick={handleSplitNow}
            className="inline-block px-10 py-4 rounded-xl font-bold text-lg transition-all hover:opacity-90"
            style={{ background: "#00c896", color: "#0a0e1a" }}
          >
            Split Your First Bill Free →
          </button>
          <p className="mt-5 text-sm" style={{ color: "#8b90a8" }}>No credit card. No account needed. US only.</p>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="py-16 md:py-24" style={{ background: "#111827" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="font-heading text-3xl md:text-4xl font-bold mb-4" style={{ color: "#f2f2f4" }}>Frequently Asked Questions</h2>
            <p className="text-lg" style={{ color: "#8b90a8" }}>Everything you need to know about BillTap.</p>
          </div>
          <div className="space-y-6">
            {[
              { q: "Do I need to download an app?", a: "No. BillTap works in any mobile browser. Guests join by scanning a QR code — no download, no account required." },
              { q: "Is BillTap really free?", a: "Yes. The free plan covers unlimited splits, up to 10 people per session, all 3 split modes, AI receipt scanning, and settlement via payment links — no credit card required. Pro ($4.99/mo) unlocks unlimited party size, expense categories, recurring bills, and bank payouts." },
              { q: "How does the QR code work?", a: "The host generates a unique QR code after scanning the receipt. Guests scan it to join the split instantly. Tokens refresh every 25 minutes for security." },
              { q: "What payment apps are supported?", a: "Venmo, Cash App, and Zelle. Guests tap their preferred method and pay in one tap. Hosts see who's paid in real time." },
              { q: "Can I split custom amounts?", a: "Yes. Custom split mode lets you assign percentages, fixed amounts, or shares. Configure it after guests join from the Session Host screen." },
              { q: "Is there a limit on group size?", a: "Free supports up to 10 people per session — enough for most dinners. When you try to add an 11th person, BillTap shows the Pro upgrade prompt. Pro ($4.99/mo) unlocks unlimited party size." },
              { q: "Is my data secure?", a: "Yes. QR tokens are HMAC-signed and time-limited. We don't sell data. Receipts and split history are private to session participants." },
            ].map((faq, i) => (
              <div key={i} className="p-6 rounded-2xl border" style={{ background: "#1e2533", borderColor: "#2d3748" }}>
                <h3 className="font-heading font-bold text-lg mb-2" style={{ color: "#f2f2f4" }}>Q: {faq.q}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "#8b90a8" }}>A: {faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="py-12 md:py-16 border-t" style={{ borderColor: "#2d3748" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-10">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <Logo size={32} />
                <span className="font-heading font-bold text-xl" style={{ color: "#00c896" }}>BillTap</span>
              </div>
              <p className="text-sm max-w-xs leading-relaxed" style={{ color: "#8b90a8" }}>
                The fastest way to split a bill. No math. No drama. No chasing anyone.
              </p>
            </div>

            <div>
              <h4 className="font-heading font-bold text-xs mb-4 uppercase tracking-wider" style={{ color: "#f2f2f4" }}>Product</h4>
              <ul className="space-y-3">
                {[
                  { label: "How It Works", href: "#how-it-works" },
                  { label: "Pricing", href: "#pricing" },
                  { label: "Security", href: "#security" },
                  { label: "FAQ", href: "#faq" },
                ].map(l => (
                  <li key={l.label}><a href={l.href} className="text-sm transition-colors hover:text-green-400" style={{ color: "#8b90a8" }}>{l.label}</a></li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-heading font-bold text-xs mb-4 uppercase tracking-wider" style={{ color: "#f2f2f4" }}>Company</h4>
              <ul className="space-y-3">
                <li><Link to="/about" className="text-sm transition-colors hover:text-green-400" style={{ color: "#8b90a8" }}>About</Link></li>
                <li><Link to="/blog" className="text-sm transition-colors hover:text-green-400" style={{ color: "#8b90a8" }}>Blog</Link></li>
                <li><a href="https://billtap.app" className="text-sm transition-colors hover:text-green-400" style={{ color: "#8b90a8" }}>billtap.app</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-heading font-bold text-xs mb-4 uppercase tracking-wider" style={{ color: "#f2f2f4" }}>Legal</h4>
              <ul className="space-y-3">
                <li><Link to="/terms" className="text-sm transition-colors hover:text-green-400" style={{ color: "#8b90a8" }}>Terms</Link></li>
                <li><Link to="/privacy" className="text-sm transition-colors hover:text-green-400" style={{ color: "#8b90a8" }}>Privacy</Link></li>
                <li><Link to="/security" className="text-sm transition-colors hover:text-green-400" style={{ color: "#8b90a8" }}>Security</Link></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t" style={{ borderColor: "#2d3748" }}>
            <p className="text-sm text-center md:text-left" style={{ color: "#4a5068" }}>
              © 2026 BillTap. Built in public by Kai Cogmon.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Check, QrCode, Camera, Users, Shield, Smartphone, CreditCard, Zap, FileText, Lock } from "lucide-react";
import Seo from "@/components/Seo";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { mkt } from "@/components/marketing/tokens";
import "@/components/marketing/marketing.css";
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
/** @param {{ name?: any, alt?: any, className?: any, position?: any, eager?: any, [key: string]: any }} props */
function Img({ name, alt, className = "", position = "center", eager = false }) {
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
      className={`mkt-img ${loaded ? "is-loaded" : ""} ${className}`}
      style={{ objectPosition: position }}
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
      className={`mkt-wash ${className}`}
      style={{ opacity, objectPosition: position }}
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
    { img: "mode-even", alt: "A receipt divided into equal glowing slices, like a pie chart.", title: "Even Split", desc: "Everyone pays the same. Auto-divides as guests join." },
    { img: "mode-itemized", alt: "A receipt with individual line items lit up separately, each floating above the paper.", title: "Itemized Split", desc: "Claim exactly what you ordered. Tax and tip prorated automatically." },
    { img: "mode-custom", alt: "Adjustable percentage sliders and segments arranged on a grid.", title: "Custom Split", desc: "Percentage, fixed amounts, or shares. You control who pays what." },
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

  // One list of facts, not two. This used to be a "By the Numbers" stat grid
  // followed immediately by a "Trust Badges" grid making nearly the same
  // claims twice in different type sizes — the tell of a page assembled from
  // template sections rather than written for what it needs to say.
  const trustFacts = [
    { icon: Users, stat: "0", label: "Accounts needed to split" },
    { icon: Lock, stat: "HMAC", label: "Signed, time-limited QR tokens" },
    { icon: Smartphone, stat: "3", label: "Payment apps: Venmo, Cash App, Zelle" },
    { icon: Shield, stat: "25min", label: "QR token refresh, for security" },
    { icon: FileText, stat: "0", label: "Data sold. Splits stay private" },
    { icon: Zap, stat: "Live", label: "Built in public, no hidden roadmap" },
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
    <div className="min-h-screen font-body" style={{ background: mkt.bg, color: mkt.text }}>
      <Seo
        path="/"
        title="BillTap — Split the Bill in 30 Seconds, No App"
        description="Scan the receipt, share a QR code, everyone claims their items and pays their exact share. No app, no accounts, no math, no IOUs."
      />

      <MarketingNav fixed scrolled={scrolled} />

      {/* ── HERO ── */}
      <section className="relative min-h-[100dvh] flex items-center pt-16 overflow-hidden mkt-dot-grid">
        {/* Full-bleed art, then the dot grid and a single static glow on top of
            it. The scrim is heavy on the left because that is where the H1 and
            subhead sit — the copy has to stay legible over whatever the render
            does there. */}
        <div className="absolute inset-0 pointer-events-none">
          <Wash name="hero" opacity={0.5} eager />
          <div className="mkt-scrim" style={{ background: "linear-gradient(90deg, rgba(10,14,26,0.96) 0%, rgba(10,14,26,0.86) 45%, rgba(10,14,26,0.6) 100%)" }} />
          <div className="mkt-scrim" style={{ background: "linear-gradient(180deg, rgba(10,14,26,0.85) 0%, transparent 30%, transparent 65%, #0a0e1a 100%)" }} />
          <div
            className="absolute"
            style={{
              top: "18%", left: "50%", transform: "translateX(-50%)",
              width: "min(70vw, 560px)", height: "min(70vw, 560px)", borderRadius: "50%",
              background: "radial-gradient(circle, rgba(0,200,150,0.1) 0%, transparent 70%)",
            }}
          />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24 w-full">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Copy */}
            <div className="space-y-6 md:space-y-8">
              <div className="mkt-fade-up inline-flex items-center gap-2 px-4 py-2 rounded-full border" style={{ borderColor: mkt.border, background: "rgba(17,24,39,0.6)" }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: mkt.accent, boxShadow: `0 0 6px ${mkt.accent}` }} />
                <span className="text-xs sm:text-sm font-medium" style={{ color: mkt.muted }}>AI-Powered · No Account Needed · US Only</span>
              </div>

              <h1 className="mkt-fade-up mkt-fade-up-1 font-heading font-bold text-5xl sm:text-6xl lg:text-7xl leading-tight">
                <span style={{ color: mkt.text }}>Scan. Split.</span>
                <br />
                <span style={{ color: mkt.accent }}>Settled.</span>
              </h1>

              <p className="mkt-fade-up mkt-fade-up-2 text-base md:text-lg lg:text-xl leading-relaxed max-w-xl" style={{ color: mkt.muted }}>
                Photograph the bill. Everyone scans the QR. Claim your items. Pay in one tap.<br className="hidden md:block" />
                No math. No awkwardness. No chasing anyone.
              </p>

              <div className="mkt-fade-up mkt-fade-up-3 flex flex-col sm:flex-row gap-4">
                <button
                  onClick={handleSplitNow}
                  className="px-8 py-4 rounded-xl font-bold text-base md:text-lg transition-opacity hover:opacity-90 text-center"
                  style={{ background: mkt.accent, color: mkt.accentInk }}
                >
                  Split a Bill Now →
                </button>
                <a href="#how-it-works" className="px-8 py-4 rounded-xl font-semibold text-base md:text-lg border transition-colors hover:border-emerald-400 text-center" style={{ borderColor: mkt.border, color: mkt.text }}>
                  See How It Works
                </a>
              </div>

              <div className="mkt-fade-up mkt-fade-up-4 flex flex-wrap items-center gap-3 pt-2">
                {["Now Live", "Built in Public", "Free Forever", "US Only"].map((tag, i) => (
                  <span key={tag} className="text-xs font-medium px-3 py-1.5 rounded-full" style={{ background: i === 0 ? "rgba(0,200,150,0.12)" : "rgba(139,144,168,0.1)", color: i === 0 ? mkt.accent : mkt.muted }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Right: Phone mockup — no fake window chrome. A phone has no
                traffic-light buttons; it just showed what a browser tab bar
                looks like on a device that has never had one. */}
            <div className="hidden lg:flex items-center justify-center">
              <div className="relative">
                <div
                  className="absolute -inset-8 rounded-3xl"
                  style={{ background: "radial-gradient(circle, rgba(0,200,150,0.16) 0%, transparent 70%)" }}
                />
                <div className="relative rounded-3xl p-8 border shadow-2xl" style={{ background: mkt.bgAlt, borderColor: mkt.border, minWidth: 280 }}>
                  <div className="flex items-center gap-2 mb-6 text-xs" style={{ color: mkt.muted }}>
                    <QrCode className="w-3.5 h-3.5" style={{ color: mkt.accent }} />
                    <span>billtap.app/claim</span>
                  </div>
                  <div className="aspect-square w-48 mx-auto rounded-2xl flex items-center justify-center mb-5" style={{ background: mkt.bg, border: `2px solid rgba(0,200,150,0.3)` }}>
                    <QrCode className="w-32 h-32" style={{ color: mkt.accent }} />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="font-heading font-bold" style={{ color: mkt.text }}>Scan to Join Split</p>
                    <p className="text-xs" style={{ color: mkt.muted }}>Table for 6 · $147.40</p>
                    <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-xs font-medium" style={{ background: "rgba(0,200,150,0.1)", color: mkt.accent }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: mkt.accent }} />
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
      <section id="how-it-works" className="relative py-16 md:py-24 overflow-hidden" style={{ background: mkt.bgAlt }}>
        <Wash name="band-steps" opacity={0.16} />
        <div className="mkt-scrim" style={{ background: "linear-gradient(180deg, #111827 0%, rgba(17,24,39,0.72) 35%, rgba(17,24,39,0.72) 65%, #111827 100%)" }} />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-4" style={{ color: mkt.text }}>How It Works</h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto" style={{ color: mkt.muted }}>Four steps to split any bill. No math required.</p>
          </div>

          {/* The whole flow in ten seconds, above the four steps that describe
              it. Phone-framed because the clip is 9:16, and capped narrow so it
              introduces the section rather than swallowing it. */}
          <div className="flex justify-center mb-12 md:mb-16">
            <div className="relative" style={{ width: "min(72vw, 260px)" }}>
              <div
                className="absolute -inset-6 rounded-3xl"
                style={{ background: "radial-gradient(circle, rgba(0,200,150,0.14) 0%, transparent 70%)" }}
              />
              <div className="relative rounded-3xl p-2.5 border shadow-2xl" style={{ background: mkt.bgAlt, borderColor: mkt.border }}>
                <DemoVideo name="product-demo" className="rounded-2xl" />
              </div>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((step, idx) => (
              <div key={idx} className="mkt-card-hover rounded-2xl border relative overflow-hidden" style={{ background: mkt.card, borderColor: mkt.border }}>
                <div className="mkt-media">
                  <Img name={step.img} alt={step.alt} />
                  {/* Fades the render into the card body so the media band
                      reads as part of the card rather than a pasted-in tile. */}
                  <div className="mkt-scrim" style={{ background: "linear-gradient(180deg, transparent 45%, rgba(30,37,51,0.85) 85%, #1e2533 100%)" }} />
                  <div className="absolute top-3 right-3 text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(10,14,26,0.75)", color: mkt.accent }}>0{idx + 1}</div>
                </div>
                <div className="p-6 md:p-7 pt-4">
                  <h3 className="font-heading font-bold text-lg mb-2" style={{ color: mkt.text }}>{step.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: mkt.muted }}>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SPLIT MODES ── */}
      <section className="py-16 md:py-24" style={{ background: mkt.bg }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-4" style={{ color: mkt.text }}>Three Ways to Split</h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto" style={{ color: mkt.muted }}>Choose the split mode that fits your group.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {splitModes.map((mode, idx) => (
              <div key={idx} className="mkt-card-hover rounded-2xl overflow-hidden border" style={{ background: mkt.card, borderColor: mkt.border }}>
                <div className="mkt-media" style={{ aspectRatio: "3 / 2" }}>
                  <Img name={mode.img} alt={mode.alt} />
                  <div className="mkt-scrim" style={{ background: "linear-gradient(180deg, transparent 50%, rgba(30,37,51,0.85) 88%, #1e2533 100%)" }} />
                  <div className="absolute top-3 right-3 text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(10,14,26,0.75)", color: mkt.accent }}>0{idx + 1}</div>
                </div>
                <div className="p-8 pt-5">
                  <h3 className="font-heading font-bold text-xl mb-3" style={{ color: mkt.text }}>{mode.title}</h3>
                  <p className="text-base leading-relaxed" style={{ color: mkt.muted }}>{mode.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES GRID ── */}
      <section id="features" className="relative py-16 md:py-24 overflow-hidden" style={{ background: mkt.bgAlt }}>
        <Wash name="band-features" opacity={0.18} />
        <div className="mkt-scrim" style={{ background: "linear-gradient(180deg, #111827 0%, rgba(17,24,39,0.7) 40%, rgba(17,24,39,0.7) 60%, #111827 100%)" }} />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-4" style={{ color: mkt.text }}>Built for Real Dinners</h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto" style={{ color: mkt.muted }}>Everything you need to split bills without the drama.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, idx) => (
              <div key={idx} className="mkt-card-hover p-6 md:p-8 rounded-2xl border" style={{ background: mkt.card, borderColor: mkt.border }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ background: "rgba(0,200,150,0.1)" }}>
                  <feature.icon className="w-5 h-5" style={{ color: mkt.accent }} />
                </div>
                <h3 className="font-heading font-bold text-lg mb-2" style={{ color: mkt.text }}>{feature.title}</h3>
                <p className="text-sm" style={{ color: mkt.muted }}>{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="py-16 md:py-24" style={{ background: mkt.bg }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold mb-4" style={{ color: mkt.text }}>Start free. Upgrade when you need more.</h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto" style={{ color: mkt.muted }}>
              Free gets most people everything they need. Pro unlocks when your use case gets serious.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {/* Free */}
            <div className="mkt-card-hover p-8 rounded-2xl border relative flex flex-col" style={{ background: mkt.card, borderColor: mkt.border }}>
              <div className="mb-6">
                <p className="text-xs font-mono tracking-widest uppercase mb-1" style={{ color: mkt.muted }}>Free</p>
                <p className="text-sm mb-4" style={{ color: mkt.muted }}>For most dinners and group meals.</p>
                <span className="text-5xl font-black" style={{ color: mkt.text }}>$0</span>
                <span className="text-base ml-2" style={{ color: mkt.muted }}>/ forever</span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {freeFeatures.map(f => (
                  <li key={f} className="flex items-start gap-3">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: mkt.accent }} />
                    <span className="text-sm" style={{ color: mkt.text }}>{f}</span>
                  </li>
                ))}
              </ul>
              <a href="/register" className="block w-full py-3.5 rounded-xl font-bold text-sm text-center transition-opacity hover:opacity-90 border" style={{ borderColor: mkt.border, color: mkt.text }}>
                Start Free
              </a>
              <p className="text-center text-xs mt-3" style={{ color: mkt.dim }}>No credit card · Always free</p>
            </div>

            {/* Pro */}
            <div className="mkt-card-hover p-8 rounded-2xl border-2 relative flex flex-col" style={{ background: mkt.card, borderColor: mkt.accent, boxShadow: "0 0 32px rgba(0,200,150,0.08)" }}>
              <div className="absolute -top-3.5 left-6 px-3 py-1 rounded-full text-xs font-bold" style={{ background: mkt.accent, color: mkt.accentInk }}>Most Popular</div>
              <div className="mb-6 pt-1">
                <p className="text-xs font-mono tracking-widest uppercase mb-1" style={{ color: mkt.accent }}>Pro</p>
                <p className="text-sm mb-4" style={{ color: mkt.muted }}>For bigger groups and recurring expenses.</p>
                <span className="text-5xl font-black" style={{ color: mkt.text }}>$4.99</span>
                <span className="text-base ml-2" style={{ color: mkt.muted }}>/ month</span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {proFeatures.map(f => (
                  <li key={f} className="flex items-start gap-3">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: mkt.accent }} />
                    <span className="text-sm" style={{ color: mkt.text }}>{f}</span>
                  </li>
                ))}
              </ul>
              <a href="/register" className="block w-full py-3.5 rounded-xl font-bold text-sm text-center transition-opacity hover:opacity-90" style={{ background: mkt.accent, color: mkt.accentInk }}>
                Start Pro Free Trial →
              </a>
              <p className="text-center text-xs mt-3" style={{ color: mkt.dim }}>14-day free trial · Then $4.99/mo</p>
            </div>
          </div>

          <div className="max-w-2xl mx-auto mt-6 p-5 rounded-xl flex gap-4 items-start" style={{ background: mkt.card, border: `1px solid ${mkt.border}` }}>
            <Zap className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: mkt.accent }} aria-hidden="true" />
            <p className="text-sm" style={{ color: mkt.muted }}>
              <span className="font-semibold" style={{ color: mkt.text }}>When does Pro kick in?</span> When you try to add an 11th person to a session, or set up a recurring bill, BillTap shows the upgrade prompt — right at the moment it's actually useful. No nag screens before then.
            </p>
          </div>

          {/* Waitlist card */}
          <div className="relative max-w-2xl mx-auto mt-10 p-6 rounded-2xl overflow-hidden border" style={{ background: mkt.card, borderColor: mkt.border, borderLeft: `4px solid ${mkt.accent}` }}>
            <Wash name="celebrate" opacity={0.2} position="top" />
            <div className="mkt-scrim" style={{ background: "linear-gradient(180deg, rgba(30,37,51,0.55) 0%, rgba(30,37,51,0.92) 55%, #1e2533 100%)" }} />
            <div className="relative">
              <h3 className="font-heading font-bold text-xl mb-2" style={{ color: mkt.text }}>Pro Features Coming Soon</h3>
              <p className="text-sm mb-5" style={{ color: mkt.muted }}>
                We're watching how people use BillTap. When we see what you actually need, we'll build it. Tell us what would make BillTap worth paying for.
              </p>
              {waitlistStatus === "done" ? (
                <div className="flex items-center gap-2 text-sm font-medium" style={{ color: mkt.accent }}>
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
                      className="flex-1 h-11 rounded-xl border px-4 text-sm bg-transparent outline-none focus:border-emerald-500 transition-colors"
                      style={{ borderColor: mkt.border, color: mkt.text }}
                    />
                    <button
                      onClick={handleWaitlist}
                      disabled={waitlistStatus === "loading"}
                      aria-busy={waitlistStatus === "loading"}
                      aria-label="Join the Pro waitlist"
                      className="px-5 h-11 rounded-xl font-semibold text-sm transition-opacity hover:opacity-90 whitespace-nowrap disabled:opacity-60"
                      style={{ background: mkt.accent, color: mkt.accentInk }}
                    >
                      {waitlistStatus === "loading" ? "..." : "Join the Waitlist →"}
                    </button>
                  </div>
                  {/* "Try again" would be a lie — nothing is recording these yet,
                      so a second attempt fails identically. */}
                  {waitlistStatus === "error" && (
                    <p role="alert" className="text-xs mt-2" style={{ color: mkt.danger }}>
                      That didn&apos;t go through. Please try again, or email hello@billtap.app and we&apos;ll add you by hand.
                    </p>
                  )}
                  <p className="text-xs mt-3" style={{ color: mkt.dim }}>No spam. One email when Pro launches. Unsubscribe anytime.</p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST SIGNALS ── (one grid, not stats-then-badges saying the same thing twice) */}
      <section id="security" className="relative py-16 md:py-24 overflow-hidden" style={{ background: mkt.bgAlt }}>
        <Wash name="band-stats" opacity={0.16} />
        <div className="mkt-scrim" style={{ background: "linear-gradient(180deg, #111827 0%, rgba(17,24,39,0.74) 40%, rgba(17,24,39,0.74) 60%, #111827 100%)" }} />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="font-heading text-3xl md:text-4xl font-bold mb-4" style={{ color: mkt.text }}>Built to Be Trusted</h2>
            <p className="text-lg" style={{ color: mkt.muted }}>The specifics, not just the adjectives. Full detail on the <a href="/security" className="underline hover:text-emerald-400" style={{ color: mkt.accent }}>Security page</a>.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {trustFacts.map((f) => (
              <div key={f.label} className="flex items-start gap-4 p-5 rounded-xl border" style={{ background: mkt.card, borderColor: mkt.border }}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0,200,150,0.1)" }}>
                  <f.icon className="w-5 h-5" style={{ color: mkt.accent }} />
                </div>
                <div>
                  <div className="font-heading font-bold text-lg" style={{ color: mkt.text }}>{f.stat}</div>
                  <p className="text-sm" style={{ color: mkt.muted }}>{f.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="relative py-16 md:py-24 overflow-hidden" style={{ background: mkt.bg }}>
        <Wash name="band-cta" opacity={0.28} />
        <div className="mkt-scrim" style={{ background: "radial-gradient(ellipse at center, rgba(10,14,26,0.55) 0%, rgba(10,14,26,0.9) 60%, #0a0e1a 100%)" }} />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-heading text-3xl md:text-5xl font-bold mb-6 leading-tight" style={{ color: mkt.text }}>
            The bill just came.
            <br />
            <span style={{ color: mkt.accent }}>Don't do the math.</span>
          </h2>
          <p className="text-lg md:text-xl mb-8 max-w-2xl mx-auto" style={{ color: mkt.muted }}>
            BillTap handles it. Scan, claim, pay. Built for real dinners with real friends. Free to start. No tricks.
          </p>
          <button
            onClick={handleSplitNow}
            className="inline-block px-10 py-4 rounded-xl font-bold text-lg transition-opacity hover:opacity-90"
            style={{ background: mkt.accent, color: mkt.accentInk }}
          >
            Split Your First Bill Free →
          </button>
          <p className="mt-5 text-sm" style={{ color: mkt.muted }}>No credit card. No account needed. US only.</p>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="py-16 md:py-24" style={{ background: mkt.bgAlt }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="font-heading text-3xl md:text-4xl font-bold mb-4" style={{ color: mkt.text }}>Frequently Asked Questions</h2>
            <p className="text-lg" style={{ color: mkt.muted }}>Everything you need to know about BillTap.</p>
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
              <div key={i} className="p-6 rounded-2xl border" style={{ background: mkt.card, borderColor: mkt.border }}>
                <h3 className="font-heading font-bold text-lg mb-2" style={{ color: mkt.text }}>{faq.q}</h3>
                <p className="text-sm leading-relaxed" style={{ color: mkt.muted }}>{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

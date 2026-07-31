import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import {
  Check, QrCode, Camera, Users, Shield, Smartphone, CreditCard, Zap, FileText, Lock,
  ArrowRight, Equal, ListChecks, SlidersHorizontal,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import Seo from "@/components/Seo";
import { art, artSrcSet, artSizes } from "@/lib/landing-assets";

const GOLD = "#f0b429";
const INK = "#0b0b0d";

/**
 * Image that fades up once decoded, and removes itself on error so the
 * gradient underneath becomes the design rather than a broken box.
 */
function Img({ name, alt, className = "", to = 1, eager = false, position = "center" }) {
  const [loaded, setLoaded] = useState(false);
  const src = art(name);
  if (!src) return null;
  return (
    <img
      src={src}
      srcSet={artSrcSet(name) || undefined}
      sizes={artSizes(name) || undefined}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      // The hero is the LCP element; everything else can wait for it.
      fetchPriority={eager ? "high" : "low"}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={(e) => { e.currentTarget.style.display = "none"; }}
      className={`lp-img lp-grade ${loaded ? "is-loaded" : ""} ${className}`}
      style={{ "--to": to, objectPosition: position }}
    />
  );
}

function Reveal({ children, delay = 0, className = "" }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const heroRef = useRef(null);
  const reduced = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistStatus, setWaitlistStatus] = useState(null); // null | "loading" | "done" | "error"

  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], ["0%", reduced ? "0%" : "18%"]);
  const heroFade = useTransform(scrollYProgress, [0, 0.9], [1, reduced ? 1 : 0.15]);

  const handleSplitNow = async () => {
    const authed = await base44.auth.isAuthenticated();
    if (authed) {
      navigate("/new-receipt");
    } else {
      navigate("/register");
    }
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

  const handleWaitlist = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(waitlistEmail.trim())) return;
    setWaitlistStatus("loading");
    try {
      // Check for duplicate before inserting
      const existing = await base44.entities.Waitlist.filter({ email: waitlistEmail.trim() });
      if (existing && existing.length > 0) {
        setWaitlistStatus("done"); // Treat as success silently (don't leak existence)
        setWaitlistEmail("");
        return;
      }
      await base44.entities.Waitlist.create({ email: waitlistEmail.trim(), app: "billtap", source: "landing_page", created_at: Date.now() });
      setWaitlistStatus("done");
      setWaitlistEmail("");
    } catch {
      setWaitlistStatus("error");
    }
  };

  const steps = [
    { n: "01", icon: Camera, img: "step-photo", title: "Photo the bill", desc: "Host photographs the receipt. AI reads every item instantly. No typing.", alt: "A hand holding a phone above a printed restaurant check, photographing it." },
    { n: "02", icon: QrCode, img: "step-qr", title: "Share the QR", desc: "A unique QR code appears. Everyone scans it. No app download. No account needed.", alt: "Friends leaning in around a table to scan a phone lying screen-up between them." },
    { n: "03", icon: Check, img: "step-claim", title: "Claim your items", desc: "Each person claims what they ordered. Tax and tip split proportionally.", alt: "A woman's thumb tapping her phone screen to pick items at a restaurant table." },
    { n: "04", icon: CreditCard, img: "step-pay", title: "Pay in one tap", desc: "Venmo, Cash App, or Zelle. One tap. Host sees paid/unpaid in real time.", alt: "A man sitting back from the table, satisfied, having just paid on his phone." },
  ];

  const splitModes = [
    { icon: Equal, img: "mode-even", title: "Even split", desc: "Everyone pays the same. Auto-divides as guests join.", alt: "Four identical glasses and plates arranged in an even grid on a dark table." },
    { icon: ListChecks, img: "mode-itemized", title: "Itemized split", desc: "Claim exactly what you ordered. Tax and tip prorated automatically.", alt: "A table of deliberately varied dishes, each plate clearly different." },
    { icon: SlidersHorizontal, img: "mode-custom", title: "Custom split", desc: "Percentage, fixed amounts, or shares. You control who pays what.", alt: "Two friends heads together over one phone, working out who owes what." },
  ];

  const features = [
    { icon: Camera, title: "AI receipt scanning", desc: "Photo the bill. AI reads every item." },
    { icon: Lock, title: "Secure QR tokens", desc: "HMAC-signed. Refreshes every 25 min." },
    { icon: Users, title: "Guest access", desc: "Scan and join. No download needed." },
    { icon: Zap, title: "Real-time tracking", desc: "See who's paid and who hasn't. Live." },
    { icon: CreditCard, title: "One-tap payment", desc: "Venmo, Cash App, or Zelle. Done." },
    { icon: FileText, title: "Bill history", desc: "Every split. Always on record." },
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

  const faqs = [
    { q: "Do I need to download an app?", a: "No. BillTap works in any mobile browser. Guests join by scanning a QR code — no download, no account required." },
    { q: "Is BillTap really free?", a: "Yes. The free plan covers unlimited splits, up to 10 people per session, all 3 split modes, AI receipt scanning, and settlement via payment links — no credit card required. Pro ($4.99/mo) unlocks unlimited party size, expense categories, recurring bills, and bank payouts." },
    { q: "How does the QR code work?", a: "The host generates a unique QR code after scanning the receipt. Guests scan it to join the split instantly. Tokens refresh every 25 minutes for security." },
    { q: "What payment apps are supported?", a: "Venmo, Cash App, and Zelle. Guests tap their preferred method and pay in one tap. Hosts see who's paid in real time." },
    { q: "Can I split custom amounts?", a: "Yes. Custom split mode lets you assign percentages, fixed amounts, or shares. Configure it after guests join from the Session Host screen." },
    { q: "Is there a limit on group size?", a: "Free supports up to 10 people per session — enough for most dinners. When you try to add an 11th person, BillTap shows the Pro upgrade prompt. Pro ($4.99/mo) unlocks unlimited party size." },
    { q: "Is my data secure?", a: "Yes. QR tokens are HMAC-signed and time-limited. We don't sell data. Receipts and split history are private to session participants." },
  ];

  return (
    <div className="min-h-screen font-body" style={{ background: INK, color: "#f5f5f4" }}>
      <Seo
        path="/"
        title="BillTap — Split the Bill in 30 Seconds, No App"
        description="Scan the receipt, share a QR code, everyone claims their items and pays their exact share. No app, no accounts, no math, no IOUs."
      />

      <style>{`
        .font-display { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; }
        .font-body    { font-family: 'Inter Tight', system-ui, sans-serif; }

        /* Eyebrow / micro-label: the one place we use caps + wide tracking. */
        .lp-eyebrow {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 10px; text-transform: uppercase; letter-spacing: .2em;
        }

        .lp-grain::after {
          content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .26;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E");
          mix-blend-mode: overlay;
        }

        /* Same grade as /restaurants so both pages read as one shoot. */
        .lp-grade { filter: saturate(.88) contrast(1.06) brightness(.94); }

        .lp-img { opacity: 0; transition: opacity .9s ease, transform 1.2s cubic-bezier(.16,1,.3,1); }
        .lp-img.is-loaded { opacity: var(--to, 1); }

        .lp-card {
          background: linear-gradient(168deg, rgba(255,255,255,.055), rgba(255,255,255,.012));
          border: 1px solid rgba(255,255,255,.09);
          border-radius: 14px;
          transition: border-color .4s ease;
        }
        .lp-card:hover { border-color: rgba(240,180,41,.28); }
        .lp-card:hover .lp-zoom { transform: scale(1.045); }

        .lp-rule { height:1px; border:0; background:linear-gradient(90deg,transparent,rgba(240,180,41,.4),transparent); }

        .lp-field {
          background-color:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.11);
          border-radius:12px; color:#f5f5f4;
          transition:border-color .18s ease, background-color .18s ease;
        }
        .lp-field::placeholder { color:rgba(245,245,244,.3); }
        .lp-field:focus { outline:none; border-color:rgba(240,180,41,.6); background-color:rgba(240,180,41,.06); }

        @keyframes lp-kenburns { from { transform: scale(1.04); } to { transform: scale(1.13); } }
        .lp-kb { animation: lp-kenburns 28s ease-in-out infinite alternate; transform-origin: 55% 45%; }

        @media (prefers-reduced-motion: reduce) {
          html { scroll-behavior:auto; }
          .lp-kb { animation: none; }
          .lp-img { transition: none; }
        }
      `}</style>

      {/* ── STICKY NAV ── */}
      <nav className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl transition-colors"
        style={{
          background: scrolled ? "rgba(11,11,13,.86)" : "rgba(11,11,13,.4)",
          borderBottom: `1px solid rgba(255,255,255,${scrolled ? ".07" : "0"})`,
        }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: GOLD }}>
              <QrCode className="w-[18px] h-[18px]" style={{ color: INK }} aria-hidden="true" />
            </div>
            <span className="font-display text-xl tracking-tight">BillTap</span>
          </Link>
          <div className="flex items-center gap-6">
            <a href="#pricing" className="hidden sm:inline text-sm" style={{ color: "rgba(245,245,244,.62)" }}>Pricing</a>
            <Link to="/restaurants" className="hidden sm:inline text-sm" style={{ color: "rgba(245,245,244,.62)" }}>For restaurants</Link>
            <button onClick={handleSplitNow}
              className="text-sm font-semibold px-4 py-2 rounded-full transition-transform hover:scale-[1.03]"
              style={{ background: GOLD, color: INK }}>
              Split a bill
            </button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <header ref={heroRef} className="relative overflow-hidden lp-grain"
        style={{ minHeight: "clamp(640px, 96vh, 920px)" }}>
        <motion.div className="absolute inset-0" style={{ y: heroY, opacity: heroFade }}>
          <div className="absolute inset-0 overflow-hidden">
            <Img name="hero" alt="" eager to={1} position="55% 45%"
              className="lp-kb absolute inset-0 w-full h-full object-cover" />
          </div>
          <div className="absolute inset-0" aria-hidden="true"
            style={{
              background:
                "radial-gradient(120% 85% at 70% 28%, rgba(240,180,41,.15) 0%, transparent 56%), linear-gradient(180deg, rgba(11,11,13,.62) 0%, rgba(11,11,13,.82) 44%, " + INK + " 96%)",
            }} />
        </motion.div>

        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 flex flex-col justify-center"
          style={{ minHeight: "clamp(640px, 96vh, 920px)" }}>
          <div className="pt-24 pb-16 max-w-3xl">
            <Reveal>
              <div className="inline-flex items-center gap-2 lp-eyebrow px-3 py-1.5 rounded-full mb-8"
                style={{ background: "rgba(240,180,41,.1)", color: GOLD, border: "1px solid rgba(240,180,41,.3)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: GOLD }} />
                No app. No accounts. No math.
              </div>
            </Reveal>

            <Reveal delay={0.06}>
              {/* Sans for the claim, serif italic for the promise — the mix is the signature. */}
              <h1 className="leading-[0.94]" style={{ fontSize: "clamp(2.5rem, 6.6vw, 4.9rem)" }}>
                <span className="font-body font-semibold tracking-[-0.04em] block">
                  Scan. Split.
                </span>
                <span className="font-display italic block mt-1" style={{
                  fontSize: "1.12em",
                  background: "linear-gradient(100deg, #f0b429 0%, #ffd97a 45%, #e0952a 100%)",
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                }}>
                  Settled in 30 seconds.
                </span>
              </h1>
            </Reveal>

            <Reveal delay={0.12}>
              <p className="mt-8 text-lg sm:text-xl leading-relaxed max-w-xl font-light"
                style={{ color: "rgba(245,245,244,.74)" }}>
                Photograph the receipt, share one QR code, and everyone claims what
                they ordered. Nobody downloads anything —{" "}
                <em className="font-display not-italic" style={{ color: "#fff", fontSize: "1.12em" }}>including you</em>.
              </p>
            </Reveal>

            <Reveal delay={0.18}>
              <div className="mt-10 flex flex-col sm:flex-row gap-3 sm:items-center">
                <button onClick={handleSplitNow}
                  className="group inline-flex items-center justify-center gap-2 font-semibold px-7 py-4 rounded-full transition-transform hover:scale-[1.02]"
                  style={{ background: GOLD, color: INK, boxShadow: "0 18px 50px -18px rgba(240,180,41,.8)" }}>
                  Split your first bill free
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </button>
                <span className="text-sm" style={{ color: "rgba(245,245,244,.45)" }}>
                  Free forever. No card. US only.
                </span>
              </div>
            </Reveal>
          </div>
        </div>
      </header>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="relative max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <Reveal>
          <p className="lp-eyebrow mb-4" style={{ color: GOLD }}>Four steps</p>
          <h2 className="font-display" style={{ fontSize: "clamp(2.1rem, 4.8vw, 3.4rem)", lineHeight: 1.05 }}>
            How it works
          </h2>
        </Reveal>

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.07} className="h-full">
              <article className="group h-full flex flex-col overflow-hidden lp-card">
                <div className="relative overflow-hidden" style={{ aspectRatio: "3 / 2" }}>
                  <div className="absolute inset-0" aria-hidden="true"
                    style={{ background: "linear-gradient(150deg, rgba(240,180,41,.16) 0%, rgba(11,11,13,.9) 70%)" }} />
                  <Img name={s.img} alt={s.alt}
                    className="lp-zoom absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-0" aria-hidden="true"
                    style={{ background: "linear-gradient(180deg, rgba(11,11,13,.1) 40%, rgba(11,11,13,.92) 100%)" }} />
                  {/* Oversized serif numeral set into the frame, not above it. */}
                  <span className="font-display absolute left-4 bottom-1 leading-none select-none"
                    style={{ fontSize: "3rem", color: GOLD, opacity: .92 }} aria-hidden="true">
                    {s.n}
                  </span>
                  <div className="absolute right-4 bottom-4 w-9 h-9 rounded-xl flex items-center justify-center backdrop-blur-md"
                    style={{ background: "rgba(240,180,41,.18)", border: "1px solid rgba(240,180,41,.4)" }}>
                    <s.icon className="w-4 h-4" style={{ color: GOLD }} aria-hidden="true" />
                  </div>
                </div>

                <div className="flex-1 p-6">
                  <h3 className="font-display text-[1.35rem] leading-[1.12]">{s.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed font-light" style={{ color: "rgba(245,245,244,.6)" }}>{s.desc}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── SPLIT MODES ── */}
      <section className="relative py-20 sm:py-28" style={{ background: "linear-gradient(180deg, #0b0b0d 0%, #131315 50%, #0b0b0d 100%)" }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <Reveal>
            <p className="lp-eyebrow mb-4" style={{ color: GOLD }}>Three ways</p>
            <h2 className="font-display" style={{ fontSize: "clamp(2.1rem, 4.8vw, 3.4rem)", lineHeight: 1.05 }}>
              However your table splits
            </h2>
          </Reveal>

          <div className="mt-12 grid sm:grid-cols-3 gap-6">
            {splitModes.map((m, i) => (
              <Reveal key={m.title} delay={i * 0.09} className="h-full">
                <article className="group h-full flex flex-col overflow-hidden lp-card">
                  <div className="relative overflow-hidden" style={{ aspectRatio: "3 / 2" }}>
                    <div className="absolute inset-0" aria-hidden="true"
                      style={{ background: "linear-gradient(150deg, rgba(240,180,41,.14), rgba(11,11,13,.9) 70%)" }} />
                    <Img name={m.img} alt={m.alt}
                      className="lp-zoom absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0" aria-hidden="true"
                      style={{ background: "linear-gradient(180deg, rgba(11,11,13,.1) 45%, rgba(11,11,13,.9) 100%)" }} />
                    <div className="absolute left-5 -bottom-5 w-10 h-10 rounded-xl flex items-center justify-center backdrop-blur-md"
                      style={{ background: "rgba(240,180,41,.18)", border: "1px solid rgba(240,180,41,.42)" }}>
                      <m.icon className="w-[18px] h-[18px]" style={{ color: GOLD }} aria-hidden="true" />
                    </div>
                  </div>
                  <div className="flex-1 p-6 pt-9">
                    <h3 className="font-display text-[1.35rem] leading-[1.12]">{m.title}</h3>
                    <p className="mt-2.5 text-sm leading-relaxed font-light" style={{ color: "rgba(245,245,244,.6)" }}>{m.desc}</p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES GRID ── */}
      <section className="relative max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <Reveal>
          <p className="lp-eyebrow mb-4" style={{ color: GOLD }}>Under the hood</p>
          <h2 className="font-display" style={{ fontSize: "clamp(2.1rem, 4.8vw, 3.4rem)", lineHeight: 1.05 }}>
            What you get
          </h2>
        </Reveal>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.05}>
              <div className="h-full p-6 lp-card">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-5"
                  style={{ background: "rgba(240,180,41,.12)", border: "1px solid rgba(240,180,41,.3)" }}>
                  <f.icon className="w-[18px] h-[18px]" style={{ color: GOLD }} aria-hidden="true" />
                </div>
                <h3 className="font-display text-[1.2rem] leading-tight">{f.title}</h3>
                <p className="mt-2 text-sm font-light" style={{ color: "rgba(245,245,244,.58)" }}>{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="relative max-w-6xl mx-auto px-5 sm:px-8 pb-20 sm:pb-28">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="lp-eyebrow mb-4" style={{ color: GOLD }}>Pricing</p>
            <h2 className="font-display" style={{ fontSize: "clamp(2.1rem, 4.8vw, 3.4rem)", lineHeight: 1.05 }}>
              Start free. Upgrade when you need more.
            </h2>
            <p className="mt-5 font-light" style={{ color: "rgba(245,245,244,.62)" }}>
              Free gets most people everything they need. Pro unlocks when your use case gets serious.
            </p>
          </div>
        </Reveal>

        <div className="grid md:grid-cols-2 gap-5 max-w-3xl mx-auto">
          {/* Free */}
          <Reveal className="h-full">
            <div className="h-full p-8 lp-card flex flex-col">
              <p className="lp-eyebrow" style={{ color: "rgba(245,245,244,.6)" }}>Free</p>
              <p className="mt-2 text-sm font-light" style={{ color: "rgba(245,245,244,.55)" }}>For most dinners and group meals.</p>
              <div className="mt-5 mb-7">
                <span className="font-display" style={{ fontSize: "3.4rem", lineHeight: 1 }}>$0</span>
                <span className="ml-2 text-sm font-light" style={{ color: "rgba(245,245,244,.45)" }}>/ forever</span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {freeFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: GOLD }} aria-hidden="true" />
                    <span className="text-sm font-light" style={{ color: "rgba(245,245,244,.82)" }}>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/register"
                className="block w-full py-3.5 rounded-full font-semibold text-sm text-center transition-colors"
                style={{ border: "1px solid rgba(255,255,255,.18)", color: "#f5f5f4" }}>
                Start free
              </Link>
              <p className="text-center text-xs mt-3 font-light" style={{ color: "rgba(245,245,244,.35)" }}>No credit card · Always free</p>
            </div>
          </Reveal>

          {/* Pro */}
          <Reveal delay={0.08} className="h-full">
            <div className="h-full p-8 flex flex-col relative rounded-[14px]"
              style={{
                background: "linear-gradient(168deg, rgba(240,180,41,.09), rgba(255,255,255,.015))",
                border: "1px solid rgba(240,180,41,.42)",
                boxShadow: "0 30px 80px -50px rgba(240,180,41,.5)",
              }}>
              <div className="absolute -top-3 left-7 px-3 py-1 rounded-full lp-eyebrow"
                style={{ background: GOLD, color: INK }}>Most popular</div>
              <p className="lp-eyebrow pt-1" style={{ color: GOLD }}>Pro</p>
              <p className="mt-2 text-sm font-light" style={{ color: "rgba(245,245,244,.55)" }}>For bigger groups and recurring expenses.</p>
              <div className="mt-5 mb-7">
                <span className="font-display" style={{ fontSize: "3.4rem", lineHeight: 1 }}>$4.99</span>
                <span className="ml-2 text-sm font-light" style={{ color: "rgba(245,245,244,.45)" }}>/ month</span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {proFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: GOLD }} aria-hidden="true" />
                    <span className="text-sm font-light" style={{ color: "rgba(245,245,244,.85)" }}>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/register"
                className="group w-full py-3.5 rounded-full font-semibold text-sm text-center transition-transform hover:scale-[1.015] inline-flex items-center justify-center gap-2"
                style={{ background: GOLD, color: INK }}>
                Start Pro free trial
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <p className="text-center text-xs mt-3 font-light" style={{ color: "rgba(245,245,244,.35)" }}>14-day free trial · Then $4.99/mo</p>
            </div>
          </Reveal>
        </div>

        {/* Monetization trigger note */}
        <Reveal delay={0.1}>
          <div className="max-w-3xl mx-auto mt-6 p-6 lp-card flex gap-4 items-start">
            <Zap className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: GOLD }} aria-hidden="true" />
            <p className="text-sm font-light leading-relaxed" style={{ color: "rgba(245,245,244,.62)" }}>
              <span className="font-normal" style={{ color: "#f5f5f4" }}>When does Pro kick in?</span> When you try to add an 11th person to a session, or set up a recurring bill, BillTap shows the upgrade prompt — right at the moment it&apos;s actually useful. No nag screens before then.
            </p>
          </div>
        </Reveal>

        {/* Waitlist */}
        <Reveal delay={0.14}>
          <div className="max-w-3xl mx-auto mt-5 p-7 rounded-[14px]"
            style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.09)", borderLeft: `3px solid ${GOLD}` }}>
            <h3 className="font-display text-[1.5rem] leading-tight">Pro features coming soon</h3>
            <p className="mt-3 text-sm font-light leading-relaxed" style={{ color: "rgba(245,245,244,.6)" }}>
              We&apos;re watching how people use BillTap. When we see what you actually need, we&apos;ll build it. Tell us what would make BillTap worth paying for.
            </p>
            {waitlistStatus === "done" ? (
              <div className="mt-5 flex items-center gap-2 text-sm" style={{ color: GOLD }} role="status" aria-live="polite">
                <Check className="w-4 h-4" aria-hidden="true" /> You&apos;re on the list. We&apos;ll email you when Pro launches. No spam ever.
              </div>
            ) : (
              <>
                <div className="mt-5 flex flex-col sm:flex-row gap-2">
                  <label htmlFor="waitlist-email" className="sr-only">Email address</label>
                  <input
                    id="waitlist-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={waitlistEmail}
                    onChange={(e) => setWaitlistEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleWaitlist()}
                    placeholder="your@email.com"
                    className="lp-field flex-1 h-12 px-4 text-sm"
                  />
                  <button
                    onClick={handleWaitlist}
                    disabled={waitlistStatus === "loading"}
                    aria-busy={waitlistStatus === "loading"}
                    aria-label="Join the Pro waitlist"
                    className="px-6 h-12 rounded-full font-semibold text-sm transition-transform hover:scale-[1.02] whitespace-nowrap disabled:opacity-60 disabled:hover:scale-100"
                    style={{ background: GOLD, color: INK }}
                  >
                    {waitlistStatus === "loading" ? "Sending" : "Join the waitlist"}
                  </button>
                </div>
                {waitlistStatus === "error" && (
                  <p role="alert" className="text-xs mt-3" style={{ color: "#ff8080" }}>Something went wrong. Please try again.</p>
                )}
                <p className="text-xs mt-3 font-light" style={{ color: "rgba(245,245,244,.38)" }}>No spam. One email when Pro launches. Unsubscribe anytime.</p>
              </>
            )}
          </div>
        </Reveal>
      </section>

      {/* ── BAND ── */}
      <section className="relative max-w-6xl mx-auto px-5 sm:px-8 pb-20 sm:pb-28">
        <Reveal>
          <div className="relative rounded-2xl overflow-hidden lp-grain"
            style={{ background: "linear-gradient(150deg, #1b1a17 0%, #0b0b0d 70%)", border: "1px solid rgba(255,255,255,.08)", minHeight: 300 }}>
            <Img name="band" alt="" to={0.6} position="65% 50%"
              className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" aria-hidden="true"
              style={{ background: "linear-gradient(90deg, rgba(11,11,13,.96) 26%, rgba(11,11,13,.35) 100%)" }} />
            <div className="relative p-8 sm:p-12 max-w-lg flex flex-col justify-center" style={{ minHeight: 300 }}>
              <p className="font-display text-[2rem] leading-[1.08]">
                The bill just came.
                <br />
                <span className="italic" style={{ color: GOLD }}>Don&apos;t do the math.</span>
              </p>
              <p className="mt-4 text-sm leading-relaxed font-light" style={{ color: "rgba(245,245,244,.66)" }}>
                Scan, claim, pay. Built for real dinners with real friends. Free to start, no tricks.
              </p>
              <button onClick={handleSplitNow}
                className="group mt-7 self-start inline-flex items-center gap-2 font-semibold px-7 py-3.5 rounded-full transition-transform hover:scale-[1.02]"
                style={{ background: GOLD, color: INK, boxShadow: "0 18px 50px -20px rgba(240,180,41,.8)" }}>
                Split your first bill free
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── TRUST SIGNALS ── */}
      <section id="security" className="relative py-20 sm:py-28" style={{ background: "linear-gradient(180deg, #0b0b0d 0%, #131315 50%, #0b0b0d 100%)" }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <Reveal>
            <p className="lp-eyebrow mb-4" style={{ color: GOLD }}>By the numbers</p>
            <h2 className="font-display" style={{ fontSize: "clamp(2.1rem, 4.8vw, 3.4rem)", lineHeight: 1.05 }}>
              What it costs you
            </h2>
          </Reveal>

          <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((stat, i) => (
              <Reveal key={stat.label} delay={i * 0.06}>
                <div className="h-full p-6 lp-card text-center">
                  <div className="font-display" style={{
                    fontSize: "2.6rem", lineHeight: 1,
                    background: "linear-gradient(100deg, #f0b429 0%, #ffd97a 50%, #e0952a 100%)",
                    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                  }}>{stat.value}</div>
                  <div className="mt-3 text-xs font-light" style={{ color: "rgba(245,245,244,.55)" }}>{stat.label}</div>
                </div>
              </Reveal>
            ))}
          </div>

          <hr className="lp-rule my-12" />

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {trustBadges.map((badge, i) => (
              <Reveal key={badge.text} delay={i * 0.04}>
                <div className="flex items-start gap-4 p-5 h-full lp-card">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(240,180,41,.12)", border: "1px solid rgba(240,180,41,.28)" }}>
                    <badge.icon className="w-4 h-4" style={{ color: GOLD }} aria-hidden="true" />
                  </div>
                  <p className="text-sm font-light pt-1.5" style={{ color: "rgba(245,245,244,.66)" }}>{badge.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="relative max-w-3xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <Reveal>
          <p className="lp-eyebrow mb-4" style={{ color: GOLD }}>Questions</p>
          <h2 className="font-display" style={{ fontSize: "clamp(2.1rem, 4.8vw, 3.4rem)", lineHeight: 1.05 }}>
            Frequently asked
          </h2>
        </Reveal>
        <div className="mt-12 space-y-4">
          {faqs.map((faq, i) => (
            <Reveal key={faq.q} delay={i * 0.04}>
              <div className="p-6 lp-card">
                <h3 className="font-display text-[1.25rem] leading-snug">{faq.q}</h3>
                <p className="mt-3 text-sm leading-relaxed font-light" style={{ color: "rgba(245,245,244,.62)" }}>{faq.a}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,.07)" }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14">
          <div className="grid md:grid-cols-4 gap-10 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: GOLD }}>
                  <QrCode className="w-[18px] h-[18px]" style={{ color: INK }} aria-hidden="true" />
                </div>
                <span className="font-display text-xl" style={{ color: GOLD }}>BillTap</span>
              </div>
              <p className="text-sm max-w-xs leading-relaxed font-light" style={{ color: "rgba(245,245,244,.55)" }}>
                The fastest way to split a bill. No math. No drama. No chasing anyone.
              </p>
            </div>

            <div>
              <h4 className="lp-eyebrow mb-4" style={{ color: "#f5f5f4" }}>Product</h4>
              <ul className="space-y-3">
                {[
                  { label: "How it works", href: "#how-it-works" },
                  { label: "Pricing", href: "#pricing" },
                  { label: "Security", href: "#security" },
                  { label: "FAQ", href: "#faq" },
                ].map((l) => (
                  <li key={l.label}><a href={l.href} className="text-sm font-light" style={{ color: "rgba(245,245,244,.55)" }}>{l.label}</a></li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="lp-eyebrow mb-4" style={{ color: "#f5f5f4" }}>Company</h4>
              <ul className="space-y-3">
                <li><Link to="/restaurants" className="text-sm font-light" style={{ color: "rgba(245,245,244,.55)" }}>For restaurants</Link></li>
                <li><Link to="/about" className="text-sm font-light" style={{ color: "rgba(245,245,244,.55)" }}>About</Link></li>
                <li><Link to="/blog" className="text-sm font-light" style={{ color: "rgba(245,245,244,.55)" }}>Blog</Link></li>
                <li><Link to="/terms" className="text-sm font-light" style={{ color: "rgba(245,245,244,.55)" }}>Terms</Link></li>
                <li><Link to="/privacy" className="text-sm font-light" style={{ color: "rgba(245,245,244,.55)" }}>Privacy</Link></li>
              </ul>
            </div>
          </div>

          <div className="pt-8" style={{ borderTop: "1px solid rgba(255,255,255,.07)" }}>
            <p className="text-sm font-light" style={{ color: "rgba(245,245,244,.38)" }}>
              © {new Date().getFullYear()} BillTap. Built in public by Kai Cogmon.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

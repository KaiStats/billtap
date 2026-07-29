import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import {
  ArrowRight, Check, X, Star, Bell, Mail, BarChart3, Smartphone,
  Zap, ThumbsUp, Cpu, Clock, Phone, Loader2,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { HERO_IMAGE, DETAIL_IMAGE } from "@/lib/restaurant-assets";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GOLD = "#f0b429";
const INK = "#0b0b0d";

const PILLARS = [
  {
    icon: Bell,
    tone: "#e5484d",
    title: "Stop 1-star reviews before they happen",
    desc: "Real-time alert the moment a guest rates you low at the table — fix it before they go public.",
  },
  {
    icon: Star,
    tone: GOLD,
    title: "Generate more 5-star Google reviews",
    desc: "Happy guests get a one-tap route to your Google listing the second they finish paying. No staff asking.",
  },
  {
    icon: Mail,
    tone: "#30a46c",
    title: "Build a customer list every night",
    desc: "Guests opt in at checkout. Those emails become your list — for promos, events, and bringing them back.",
  },
  {
    icon: BarChart3,
    tone: "#3b82f6",
    title: "Know exactly how you're performing",
    desc: "Monthly email report: average rating, new contacts, reviews captured. No dashboards, no homework.",
  },
];

const BULLETS = [
  { icon: Smartphone, title: "No app to download", desc: "Just scan and go." },
  { icon: Zap, title: "Split & pay in 30 seconds", desc: "Fast, simple, frictionless." },
  { icon: ThumbsUp, title: "Rate you on Google instantly", desc: "Good experiences get shared." },
  { icon: Mail, title: "You get the data & reviews", desc: "More customers. More revenue." },
  { icon: Cpu, title: "Works with your POS", desc: "No new hardware. No disruption." },
  { icon: Clock, title: "Setup in under 10 minutes", desc: "We do the heavy lifting." },
];

const PERFECT_FOR = [
  "Steakhouses", "Mexican Restaurants", "Sushi", "BBQ",
  "Breweries", "Sports Bars", "Family Restaurants",
];

const WITHOUT = ["Missed reviews", "Lost customer emails", "Surprise 1-star reviews", "No guest insights", "Harder to grow"];
const WITH = ["More 5-star reviews", "Build your customer list", "Instant bad-experience alerts", "Know your numbers", "More repeat customers"];

const STEPS = [
  { n: "1", title: "Guests scan a QR on the table", desc: "No app needed." },
  { n: "2", title: "They split the check", desc: "Everyone pays their share in about 30 seconds." },
  { n: "3", title: "They rate you", desc: "Good goes to Google. Bad pings you instantly." },
];

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

export default function Restaurants() {
  const heroRef = useRef(null);
  const formRef = useRef(null);
  const reduced = useReducedMotion();

  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], ["0%", reduced ? "0%" : "18%"]);
  const heroFade = useTransform(scrollYProgress, [0, 0.9], [1, reduced ? 1 : 0.15]);

  const [form, setForm] = useState({
    restaurant_name: "", contact_name: "", email: "", phone: "",
    locations: "1", company_website: "",
  });
  const [status, setStatus] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (typeof window.fbq === "function") window.fbq("trackCustom", "RestaurantsPageView");
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const scrollToForm = () =>
    formRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status === "loading") return;

    const restaurant_name = form.restaurant_name.trim();
    const email = form.email.trim().toLowerCase();
    if (!restaurant_name) { setErrorMsg("Tell us the restaurant's name."); setStatus("error"); return; }
    if (!EMAIL_RE.test(email)) { setErrorMsg("That email doesn't look right."); setStatus("error"); return; }

    setStatus("loading");
    setErrorMsg("");

    const payload = {
      restaurant_name,
      contact_name: form.contact_name.trim(),
      email,
      phone: form.phone.trim(),
      locations: form.locations,
      company_website: form.company_website,
      source: "restaurants_page",
    };

    try {
      // Save first — the lead is the thing that must not be lost.
      await base44.entities.RestaurantLead.create({
        restaurant_name, contact_name: payload.contact_name, email,
        phone: payload.phone, locations: payload.locations,
        plan_interest: "trial", source: payload.source, created_at: Date.now(),
      });
    } catch {
      setErrorMsg("Couldn't save that. Call (702) 844-0938 and we'll set you up by hand.");
      setStatus("error");
      return;
    }

    try {
      await fetch("/api/restaurant-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch { /* lead is saved */ }

    if (typeof window.fbq === "function") window.fbq("trackCustom", "RestaurantLead");
    if (typeof window.gtag === "function") window.gtag("event", "generate_lead", { value: 149, currency: "USD" });
    setStatus("done");
  };

  return (
    <div className="min-h-screen font-body" style={{ background: INK, color: "#f5f5f4" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap');
        .font-heading { font-family: 'Space Grotesk', sans-serif; }
        .font-body { font-family: 'Inter', sans-serif; }
        .rst-grain::after {
          content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .26;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E");
          mix-blend-mode: overlay;
        }
        .rst-rule { height:1px; border:0; background:linear-gradient(90deg,transparent,rgba(240,180,41,.4),transparent); }
        .rst-field {
          width:100%; background-color:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.11);
          border-radius:12px; padding:13px 15px; color:#f5f5f4; font-size:15px;
          transition:border-color .18s ease, background-color .18s ease;
        }
        .rst-field::placeholder { color:rgba(245,245,244,.3); }
        .rst-field:focus { outline:none; border-color:rgba(240,180,41,.6); background-color:rgba(240,180,41,.06); }
        .rst-field:focus-visible { outline:2px solid rgba(240,180,41,.35); outline-offset:2px; }
        select.rst-field {
          appearance:none; -webkit-appearance:none; padding-right:38px; line-height:1.35;
          background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%23f5f5f4' stroke-opacity='.5' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat:no-repeat; background-position:right 14px center;
        }
        @media (prefers-reduced-motion: reduce) { html { scroll-behavior:auto; } }
      `}</style>

      {/* ── Nav ─────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl"
        style={{ background: "rgba(11,11,13,.8)", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: GOLD }}>
              <span className="font-black text-sm" style={{ color: INK }}>B</span>
            </div>
            <span className="font-heading font-bold tracking-tight" style={{ color: "#f5f5f4" }}>BillTap</span>
            <span className="hidden sm:inline text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full"
              style={{ background: "rgba(240,180,41,.1)", color: GOLD, border: "1px solid rgba(240,180,41,.25)" }}>
              For Restaurants
            </span>
          </Link>
          <button onClick={scrollToForm}
            className="text-sm font-bold px-4 py-2 rounded-full transition-transform hover:scale-[1.03]"
            style={{ background: GOLD, color: INK }}>
            Start free trial
          </button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────── */}
      <header ref={heroRef} className="relative overflow-hidden rst-grain"
        style={{ minHeight: "clamp(640px, 96vh, 920px)" }}>
        <motion.div className="absolute inset-0" style={{ y: heroY, opacity: heroFade }}>
          <div className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${HERO_IMAGE})` }} aria-hidden="true" />
          <div className="absolute inset-0" aria-hidden="true"
            style={{
              background:
                "radial-gradient(120% 85% at 74% 26%, rgba(240,180,41,.15) 0%, transparent 56%), linear-gradient(180deg, rgba(11,11,13,.66) 0%, rgba(11,11,13,.84) 44%, " + INK + " 96%)",
            }} />
        </motion.div>

        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 flex flex-col justify-center"
          style={{ minHeight: "clamp(640px, 96vh, 920px)" }}>
          <div className="pt-24 pb-16 max-w-3xl">
            <Reveal>
              <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] px-3 py-1.5 rounded-full mb-7"
                style={{ background: "rgba(240,180,41,.1)", color: GOLD, border: "1px solid rgba(240,180,41,.3)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: GOLD }} />
                Your guests split the bill free — you get the reviews
              </div>
            </Reveal>

            <Reveal delay={0.06}>
              <h1 className="font-heading font-bold leading-[0.98] tracking-[-0.035em]"
                style={{ fontSize: "clamp(2.4rem, 6.4vw, 4.6rem)" }}>
                Turn every split check into
                <br />
                <span style={{
                  background: "linear-gradient(100deg, #f0b429 0%, #ffd97a 45%, #e0952a 100%)",
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                }}>
                  more 5-star reviews.
                </span>
              </h1>
            </Reveal>

            <Reveal delay={0.12}>
              <p className="mt-7 text-lg sm:text-xl leading-relaxed max-w-xl" style={{ color: "rgba(245,245,244,.72)" }}>
                The easiest way to increase Google reviews, build your customer list, and
                catch unhappy guests <strong style={{ color: "#fff" }}>before they leave</strong>.
              </p>
            </Reveal>

            <Reveal delay={0.18}>
              <div className="mt-10 flex flex-col sm:flex-row gap-3 sm:items-center">
                <button onClick={scrollToForm}
                  className="group inline-flex items-center justify-center gap-2 font-bold px-7 py-4 rounded-full transition-transform hover:scale-[1.02]"
                  style={{ background: GOLD, color: INK, boxShadow: "0 18px 50px -18px rgba(240,180,41,.8)" }}>
                  Start free trial
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </button>
                <span className="text-sm" style={{ color: "rgba(245,245,244,.45)" }}>
                  14-day free trial. Cancel anytime.
                </span>
              </div>
            </Reveal>
          </div>
        </div>
      </header>

      {/* ── Four pillars ────────────────────────────────────── */}
      <section className="relative max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.07}>
              <div className="h-full p-6 rounded-2xl"
                style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-5"
                  style={{ background: `${p.tone}1a`, border: `1px solid ${p.tone}44` }}>
                  <p.icon className="w-5 h-5" style={{ color: p.tone }} aria-hidden="true" />
                </div>
                <h3 className="font-heading font-semibold text-base leading-snug tracking-[-0.01em]">{p.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed" style={{ color: "rgba(245,245,244,.56)" }}>{p.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Trust strip */}
        <Reveal delay={0.1}>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px rounded-2xl overflow-hidden"
            style={{ background: "rgba(240,180,41,.16)", border: "1px solid rgba(240,180,41,.3)" }}>
            {BULLETS.map((b) => (
              <div key={b.title} className="p-5" style={{ background: INK }}>
                <b.icon className="w-4 h-4 mb-3" style={{ color: GOLD }} aria-hidden="true" />
                <p className="text-xs font-bold uppercase tracking-wide leading-tight">{b.title}</p>
                <p className="mt-1.5 text-xs" style={{ color: "rgba(245,245,244,.48)" }}>{b.desc}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── Without / With ──────────────────────────────────── */}
      <section className="relative max-w-6xl mx-auto px-5 sm:px-8 pb-20 sm:pb-28">
        <div className="grid lg:grid-cols-3 gap-6">
          <Reveal>
            <div className="h-full p-7 rounded-2xl" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" }}>
              <h3 className="font-heading font-bold text-lg" style={{ color: GOLD }}>Perfect for</h3>
              <ul className="mt-5 space-y-2.5">
                {PERFECT_FOR.map((t) => (
                  <li key={t} className="text-sm" style={{ color: "rgba(245,245,244,.78)" }}>{t}</li>
                ))}
              </ul>
              <hr className="rst-rule my-6" />
              <p className="text-sm leading-relaxed" style={{ color: "rgba(245,245,244,.6)" }}>
                Built for independent restaurants that want more repeat customers
                without changing their POS.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.08} className="lg:col-span-2">
            <div className="h-full grid sm:grid-cols-2 gap-4">
              <div className="p-7 rounded-2xl" style={{ background: "rgba(229,72,77,.06)", border: "1px solid rgba(229,72,77,.22)" }}>
                <h3 className="font-heading font-bold text-sm uppercase tracking-wider" style={{ color: "#e5484d" }}>Without BillTap</h3>
                <ul className="mt-5 space-y-3">
                  {WITHOUT.map((t) => (
                    <li key={t} className="flex items-start gap-2.5 text-sm" style={{ color: "rgba(245,245,244,.72)" }}>
                      <X className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#e5484d" }} aria-hidden="true" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-7 rounded-2xl" style={{ background: "rgba(48,164,108,.07)", border: "1px solid rgba(48,164,108,.25)" }}>
                <h3 className="font-heading font-bold text-sm uppercase tracking-wider" style={{ color: "#30a46c" }}>With BillTap</h3>
                <ul className="mt-5 space-y-3">
                  {WITH.map((t) => (
                    <li key={t} className="flex items-start gap-2.5 text-sm" style={{ color: "rgba(245,245,244,.85)" }}>
                      <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#30a46c" }} aria-hidden="true" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────── */}
      <section className="relative py-20 sm:py-28" style={{ background: "linear-gradient(180deg, #0b0b0d 0%, #131315 50%, #0b0b0d 100%)" }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <Reveal>
            <h2 className="font-heading font-bold tracking-[-0.03em]" style={{ fontSize: "clamp(1.9rem, 4.4vw, 3rem)" }}>
              How it works
            </h2>
          </Reveal>
          <div className="mt-12 grid sm:grid-cols-3 gap-8">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.1}>
                <div>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center font-heading font-bold text-sm mb-5"
                    style={{ background: GOLD, color: INK }}>{s.n}</div>
                  <h3 className="font-heading font-semibold text-lg tracking-[-0.015em]">{s.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed" style={{ color: "rgba(245,245,244,.56)" }}>{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.3}>
            <div className="mt-14 relative rounded-2xl overflow-hidden rst-grain"
              style={{ background: "linear-gradient(150deg, #1b1a17 0%, #0b0b0d 70%)", border: "1px solid rgba(255,255,255,.08)", minHeight: 200 }}>
              <div className="absolute inset-0 bg-cover bg-center opacity-60"
                style={{ backgroundImage: `url(${DETAIL_IMAGE})` }} aria-hidden="true" />
              <div className="absolute inset-0" aria-hidden="true"
                style={{ background: "linear-gradient(90deg, rgba(11,11,13,.94) 30%, rgba(11,11,13,.4) 100%)" }} />
              <div className="relative p-8 sm:p-10 max-w-md">
                <p className="font-heading font-bold text-xl leading-snug">Your staff does nothing differently.</p>
                <p className="mt-2.5 text-sm" style={{ color: "rgba(245,245,244,.6)" }}>
                  The table tent does the work. No new hardware, no POS change, live in minutes.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Pricing + form ──────────────────────────────────── */}
      <section ref={formRef} className="relative max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          <Reveal>
            <div>
              <p className="text-sm uppercase tracking-[0.18em]" style={{ color: GOLD }}>
                Plans that pay for themselves
              </p>
              <h2 className="mt-3 font-heading font-bold tracking-[-0.03em]" style={{ fontSize: "clamp(2.4rem, 5.4vw, 3.6rem)" }}>
                $149<span style={{ color: "rgba(245,245,244,.4)", fontSize: "0.36em" }}>/month</span>
              </h2>
              <p className="mt-5 leading-relaxed" style={{ color: "rgba(245,245,244,.66)" }}>
                Pays for itself with just one or two additional returning tables each month.
              </p>

              <ul className="mt-8 space-y-3">
                {["14-day free trial", "Cancel anytime", "Printed QR table tents included",
                  "Unlimited tables and covers", "Setup in under 10 minutes"].map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <Check className="w-4 h-4 mt-1 flex-shrink-0" style={{ color: GOLD }} aria-hidden="true" />
                    <span className="text-sm" style={{ color: "rgba(245,245,244,.8)" }}>{f}</span>
                  </li>
                ))}
              </ul>

              <hr className="rst-rule my-8" />
              <p className="text-sm font-bold uppercase tracking-wider" style={{ color: GOLD }}>Questions? Let's talk.</p>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <a href="tel:+17028440938" className="flex items-center gap-2" style={{ color: "rgba(245,245,244,.82)" }}>
                  <Phone className="w-3.5 h-3.5" style={{ color: GOLD }} aria-hidden="true" />
                  (702) 844-0938
                </a>
                <a href="mailto:alerts@billtap.app" className="flex items-center gap-2" style={{ color: "rgba(245,245,244,.82)" }}>
                  <Mail className="w-3.5 h-3.5" style={{ color: GOLD }} aria-hidden="true" />
                  alerts@billtap.app
                </a>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="p-7 sm:p-9 rounded-3xl"
              style={{
                background: "linear-gradient(165deg, rgba(255,255,255,.05) 0%, rgba(255,255,255,.015) 100%)",
                border: "1px solid rgba(255,255,255,.1)",
                boxShadow: "0 40px 90px -50px rgba(0,0,0,.95)",
              }}>
              {status === "done" ? (
                <div className="py-10 text-center" role="status" aria-live="polite">
                  <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-6"
                    style={{ background: "rgba(240,180,41,.14)", border: "1px solid rgba(240,180,41,.35)" }}>
                    <Check className="w-7 h-7" style={{ color: GOLD }} aria-hidden="true" />
                  </div>
                  <h3 className="font-heading font-bold text-2xl tracking-[-0.02em]">You're in.</h3>
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: "rgba(245,245,244,.62)" }}>
                    We'll call within one business day to get your table tents printed and
                    your trial switched on. Sooner is fine too — (702) 844-0938.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate>
                  <h3 className="font-heading font-bold text-2xl tracking-[-0.02em]">Start your free trial</h3>
                  <p className="mt-2 text-sm" style={{ color: "rgba(245,245,244,.54)" }}>
                    14 days free. No card. Takes about twenty seconds.
                  </p>

                  <div className="mt-7 space-y-4">
                    <div>
                      <label htmlFor="rst-name" className="block text-xs font-medium mb-2" style={{ color: "rgba(245,245,244,.64)" }}>
                        Restaurant name <span style={{ color: GOLD }}>*</span>
                      </label>
                      <input id="rst-name" className="rst-field" type="text" autoComplete="organization"
                        placeholder="Rosewood Kitchen" value={form.restaurant_name}
                        onChange={set("restaurant_name")} required />
                    </div>
                    <div>
                      <label htmlFor="rst-contact" className="block text-xs font-medium mb-2" style={{ color: "rgba(245,245,244,.64)" }}>
                        Your name
                      </label>
                      <input id="rst-contact" className="rst-field" type="text" autoComplete="name"
                        placeholder="Alex Rivera" value={form.contact_name} onChange={set("contact_name")} />
                    </div>
                    <div>
                      <label htmlFor="rst-email" className="block text-xs font-medium mb-2" style={{ color: "rgba(245,245,244,.64)" }}>
                        Email <span style={{ color: GOLD }}>*</span>
                      </label>
                      <input id="rst-email" className="rst-field" type="email" autoComplete="email" inputMode="email"
                        placeholder="you@restaurant.com" value={form.email} onChange={set("email")} required />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="rst-phone" className="block text-xs font-medium mb-2" style={{ color: "rgba(245,245,244,.64)" }}>Phone</label>
                        <input id="rst-phone" className="rst-field" type="tel" autoComplete="tel" inputMode="tel"
                          placeholder="(555) 012-3456" value={form.phone} onChange={set("phone")} />
                      </div>
                      <div>
                        <label htmlFor="rst-locations" className="block text-xs font-medium mb-2" style={{ color: "rgba(245,245,244,.64)" }}>Locations</label>
                        <select id="rst-locations" className="rst-field" value={form.locations} onChange={set("locations")}>
                          {["1", "2-5", "6-20", "20+"].map((v) => (
                            <option key={v} value={v} style={{ background: INK }}>{v === "2-5" ? "2–5" : v}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Honeypot — hidden from people, catnip for bots. */}
                    <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", opacity: 0 }}>
                      <label htmlFor="rst-website">Company website</label>
                      <input id="rst-website" type="text" tabIndex={-1} autoComplete="off"
                        value={form.company_website} onChange={set("company_website")} />
                    </div>
                  </div>

                  {status === "error" && (
                    <p className="mt-4 text-sm" style={{ color: "#ff8080" }} role="alert">{errorMsg}</p>
                  )}

                  <button type="submit" disabled={status === "loading"}
                    className="mt-7 w-full inline-flex items-center justify-center gap-2 font-bold px-6 py-4 rounded-full transition-transform hover:scale-[1.015] disabled:opacity-60 disabled:hover:scale-100"
                    style={{ background: GOLD, color: INK, boxShadow: "0 18px 50px -22px rgba(240,180,41,.85)" }}>
                    {status === "loading"
                      ? (<><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Sending</>)
                      : (<>Start my free trial<ArrowRight className="w-4 h-4" aria-hidden="true" /></>)}
                  </button>

                  <p className="mt-4 text-xs text-center leading-relaxed" style={{ color: "rgba(245,245,244,.4)" }}>
                    We'll only use this to talk to you about your trial. No lists, no resale.
                  </p>
                </form>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,.07)" }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10">
          <p className="font-heading font-bold text-lg" style={{ color: GOLD }}>
            More Reviews. More Customers. More Revenue.
          </p>
          <div className="mt-5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <p className="text-sm" style={{ color: "rgba(245,245,244,.4)" }}>© {new Date().getFullYear()} BillTap</p>
            <div className="flex gap-6 text-sm">
              <Link to="/" style={{ color: "rgba(245,245,244,.58)" }}>Consumer app</Link>
              <Link to="/privacy" style={{ color: "rgba(245,245,244,.58)" }}>Privacy</Link>
              <Link to="/terms" style={{ color: "rgba(245,245,244,.58)" }}>Terms</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

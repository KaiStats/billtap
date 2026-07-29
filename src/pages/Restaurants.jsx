import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Star, Bell, Mail, BarChart3, Plug, QrCode, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { HERO_IMAGE, DETAIL_IMAGE } from "@/lib/restaurant-assets";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CAPABILITIES = [
  {
    icon: Bell,
    title: "Low-rating alerts",
    desc: "A guest rates you 3 stars or below and your phone buzzes before they reach the parking lot. You get the save, not the review.",
  },
  {
    icon: Star,
    title: "Google review engine",
    desc: "Happy tables get routed straight to your Google listing at the moment they're happiest — right after they've paid.",
  },
  {
    icon: Mail,
    title: "Guest email capture",
    desc: "Every split builds your list. Real emails from real diners who actually sat in your room.",
  },
  {
    icon: BarChart3,
    title: "Monthly performance report",
    desc: "Covers, average check, split behavior, sentiment trend. One page, first of the month, no dashboard to log into.",
  },
  {
    icon: Plug,
    title: "POS integration",
    desc: "Toast, Square, and Clover. Checks flow in automatically — no photographing receipts, no double entry.",
  },
];

const STEPS = [
  { n: "01", title: "Table tents go out", desc: "We ship printed QR tents for every table. Takes one service to deploy." },
  { n: "02", title: "Guests split the check", desc: "They scan, claim their items, and pay their exact share. No app download, no account." },
  { n: "03", title: "You get the signal", desc: "Reviews, emails, and sentiment land in your inbox. Your staff does nothing differently." },
];

const PILOT_INCLUDES = [
  "Unlimited tables and covers",
  "Printed QR table tents, shipped free",
  "Low-rating alerts to your phone",
  "Google review routing",
  "Guest email capture and export",
  "Monthly performance report",
  "Direct line to the founder",
];

/** Section wrapper with a scroll-triggered reveal that respects reduced motion. */
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
    restaurant_name: "",
    contact_name: "",
    email: "",
    phone: "",
    locations: "1",
    company_website: "", // honeypot — hidden from real users
  });
  const [status, setStatus] = useState(null); // null | "loading" | "done" | "error"
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (typeof window.fbq === "function") window.fbq("trackCustom", "RestaurantsPageView");
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status === "loading") return;

    const restaurant_name = form.restaurant_name.trim();
    const email = form.email.trim().toLowerCase();

    if (!restaurant_name) {
      setErrorMsg("Tell us the restaurant's name.");
      setStatus("error");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setErrorMsg("That email doesn't look right.");
      setStatus("error");
      return;
    }

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
        restaurant_name: payload.restaurant_name,
        contact_name: payload.contact_name,
        email: payload.email,
        phone: payload.phone,
        locations: payload.locations,
        plan_interest: "pilot",
        source: payload.source,
        created_at: Date.now(),
      });
    } catch {
      setErrorMsg("Couldn't save that. Email alerts@billtap.app and we'll set you up by hand.");
      setStatus("error");
      return;
    }

    // Notify. Best-effort: the lead is already stored, so a mail failure
    // must not read as a failure to the operator.
    try {
      await fetch("/api/restaurant-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      /* swallow — lead is saved */
    }

    if (typeof window.fbq === "function") window.fbq("trackCustom", "RestaurantLead");
    if (typeof window.gtag === "function") window.gtag("event", "generate_lead", { value: 149, currency: "USD" });

    setStatus("done");
  };

  return (
    <div className="min-h-screen font-body" style={{ background: "#0a0e1a", color: "#f2f2f4" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap');
        .font-heading { font-family: 'Space Grotesk', sans-serif; }
        .font-body { font-family: 'Inter', sans-serif; }
        .rst-grain::after {
          content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .28;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E");
          mix-blend-mode: overlay;
        }
        .rst-rule {
          height: 1px; border: 0;
          background: linear-gradient(90deg, transparent, rgba(0,200,150,.35), transparent);
        }
        .rst-field {
          width: 100%; background-color: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.10);
          border-radius: 12px; padding: 13px 15px; color: #f2f2f4; font-size: 15px;
          transition: border-color .18s ease, background .18s ease;
        }
        .rst-field::placeholder { color: rgba(242,242,244,.32); }
        .rst-field:focus {
          outline: none; border-color: rgba(0,200,150,.55); background-color: rgba(0,200,150,.05);
        }
        .rst-field:focus-visible { outline: 2px solid rgba(0,200,150,.35); outline-offset: 2px; }
        /* Native select renders at a different height and draws its own chevron —
           normalize both so the row lines up with the text inputs beside it. */
        select.rst-field {
          appearance: none; -webkit-appearance: none;
          padding-right: 38px; line-height: 1.35;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%23f2f2f4' stroke-opacity='.5' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 14px center;
        }
        @media (prefers-reduced-motion: reduce) {
          html { scroll-behavior: auto; }
        }
      `}</style>

      {/* ── Nav ─────────────────────────────────────────────── */}
      <nav
        className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl"
        style={{ background: "rgba(10,14,26,.72)", borderBottom: "1px solid rgba(255,255,255,.06)" }}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "#00c896" }}
            >
              <span className="text-white font-black text-sm">B</span>
            </div>
            <span className="font-heading font-bold tracking-tight" style={{ color: "#f2f2f4" }}>BillTap</span>
            <span
              className="hidden sm:inline text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full"
              style={{ background: "rgba(0,200,150,.10)", color: "#00c896", border: "1px solid rgba(0,200,150,.22)" }}
            >
              for Restaurants
            </span>
          </Link>
          <button
            onClick={scrollToForm}
            className="text-sm font-semibold px-4 py-2 rounded-full transition-transform hover:scale-[1.03]"
            style={{ background: "#00c896", color: "#04231a" }}
          >
            Apply for the pilot
          </button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────── */}
      <header ref={heroRef} className="relative overflow-hidden rst-grain" style={{ minHeight: "clamp(620px, 94vh, 900px)" }}>
        <motion.div className="absolute inset-0" style={{ y: heroY, opacity: heroFade }}>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${HERO_IMAGE})` }}
            aria-hidden="true"
          />
          {/* Scrim: readable type over any image, and a credible look without one. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 85% at 72% 28%, rgba(0,200,150,.16) 0%, transparent 55%), linear-gradient(180deg, rgba(10,14,26,.62) 0%, rgba(10,14,26,.80) 42%, #0a0e1a 96%)",
            }}
            aria-hidden="true"
          />
        </motion.div>

        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 flex flex-col justify-center" style={{ minHeight: "clamp(620px, 94vh, 900px)" }}>
          <div className="pt-24 pb-16 max-w-3xl">
            <Reveal>
              <div
                className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] px-3 py-1.5 rounded-full mb-7"
                style={{ background: "rgba(212,175,55,.09)", color: "#d4af37", border: "1px solid rgba(212,175,55,.28)" }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#d4af37" }} />
                Founding partner pilot — 12 restaurants
              </div>
            </Reveal>

            <Reveal delay={0.06}>
              <h1
                className="font-heading font-bold leading-[0.97] tracking-[-0.035em]"
                style={{ fontSize: "clamp(2.6rem, 7.2vw, 5.1rem)" }}
              >
                The bad review
                <br />
                <span
                  style={{
                    background: "linear-gradient(105deg, #00c896 0%, #7ee8c4 42%, #d4af37 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  never gets written.
                </span>
              </h1>
            </Reveal>

            <Reveal delay={0.12}>
              <p
                className="mt-7 text-lg sm:text-xl leading-relaxed max-w-xl"
                style={{ color: "rgba(242,242,244,.72)" }}
              >
                BillTap turns the check into your best listening post. Guests split the bill from a
                QR code on the table — and the unhappy ones reach you before they reach Google.
              </p>
            </Reveal>

            <Reveal delay={0.18}>
              <div className="mt-10 flex flex-col sm:flex-row gap-3 sm:items-center">
                <button
                  onClick={scrollToForm}
                  className="group inline-flex items-center justify-center gap-2 font-semibold px-7 py-4 rounded-full transition-transform hover:scale-[1.02]"
                  style={{ background: "#00c896", color: "#04231a", boxShadow: "0 18px 50px -18px rgba(0,200,150,.75)" }}
                >
                  Start free trial
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </button>
                <span className="text-sm" style={{ color: "rgba(242,242,244,.42)" }}>
                  No card. No POS change. Cancel anytime.
                </span>
              </div>
            </Reveal>
          </div>
        </div>
      </header>

      {/* ── The stake ───────────────────────────────────────── */}
      <section className="relative max-w-6xl mx-auto px-5 sm:px-8 py-24 sm:py-32">
        <Reveal>
          <p
            className="font-heading leading-[1.22] tracking-[-0.02em] max-w-4xl"
            style={{ fontSize: "clamp(1.55rem, 3.6vw, 2.6rem)" }}
          >
            A one-star review costs you roughly{" "}
            <span style={{ color: "#00c896" }}>thirty covers</span>. The guest who wrote it sat in
            your dining room forty minutes earlier — and you had no way to know.
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <hr className="rst-rule my-12" />
        </Reveal>
        <div className="grid sm:grid-cols-3 gap-10 sm:gap-8">
          {[
            { v: "94%", l: "of diners read reviews before choosing where to eat" },
            { v: "0", l: "apps your guests need to download to split a check" },
            { v: "1 service", l: "to deploy — table tents and you're live" },
          ].map((s, i) => (
            <Reveal key={s.l} delay={0.14 + i * 0.07}>
              <div>
                <div
                  className="font-heading font-bold tracking-[-0.03em]"
                  style={{ fontSize: "clamp(2.1rem, 4.4vw, 3rem)", color: "#00c896" }}
                >
                  {s.v}
                </div>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "rgba(242,242,244,.55)" }}>
                  {s.l}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Capabilities ────────────────────────────────────── */}
      <section className="relative max-w-6xl mx-auto px-5 sm:px-8 pb-24 sm:pb-32">
        <Reveal>
          <h2
            className="font-heading font-bold tracking-[-0.03em]"
            style={{ fontSize: "clamp(2rem, 4.6vw, 3.2rem)" }}
          >
            What lands in the pilot
          </h2>
          <p className="mt-4 max-w-xl leading-relaxed" style={{ color: "rgba(242,242,244,.58)" }}>
            Founding partners get every capability below as it ships, and shape the order it
            ships in. Your feedback is the roadmap.
          </p>
        </Reveal>

        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CAPABILITIES.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.06}>
              <div
                className="group h-full p-7 rounded-2xl transition-colors duration-300"
                style={{ background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.07)" }}
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-5"
                  style={{ background: "rgba(0,200,150,.10)", border: "1px solid rgba(0,200,150,.20)" }}
                >
                  <c.icon className="w-5 h-5" style={{ color: "#00c896" }} aria-hidden="true" />
                </div>
                <h3 className="font-heading font-semibold text-lg tracking-[-0.01em]">{c.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed" style={{ color: "rgba(242,242,244,.56)" }}>
                  {c.desc}
                </p>
              </div>
            </Reveal>
          ))}

          {/* Editorial tile — image with a self-sufficient gradient underneath. */}
          <Reveal delay={0.3}>
            <div
              className="relative h-full min-h-[240px] rounded-2xl overflow-hidden rst-grain"
              style={{
                background: "linear-gradient(150deg, #10233a 0%, #0a0e1a 70%)",
                border: "1px solid rgba(255,255,255,.07)",
              }}
            >
              <div
                className="absolute inset-0 bg-cover bg-center opacity-70"
                style={{ backgroundImage: `url(${DETAIL_IMAGE})` }}
                aria-hidden="true"
              />
              <div
                className="absolute inset-0"
                style={{ background: "linear-gradient(180deg, rgba(10,14,26,.15) 0%, rgba(10,14,26,.92) 100%)" }}
                aria-hidden="true"
              />
              <div className="relative h-full flex flex-col justify-end p-7">
                <QrCode className="w-6 h-6 mb-3" style={{ color: "#00c896" }} aria-hidden="true" />
                <p className="font-heading font-semibold text-lg leading-snug">
                  Your staff does nothing differently.
                </p>
                <p className="mt-2 text-sm" style={{ color: "rgba(242,242,244,.55)" }}>
                  The table tent does the work.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────── */}
      <section
        className="relative py-24 sm:py-32"
        style={{ background: "linear-gradient(180deg, #0a0e1a 0%, #0c1322 50%, #0a0e1a 100%)" }}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <Reveal>
            <h2
              className="font-heading font-bold tracking-[-0.03em]"
              style={{ fontSize: "clamp(2rem, 4.6vw, 3.2rem)" }}
            >
              Live in one service
            </h2>
          </Reveal>
          <div className="mt-14 grid sm:grid-cols-3 gap-8">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.1}>
                <div>
                  <div
                    className="font-heading font-bold text-sm tracking-[0.2em] mb-4"
                    style={{ color: "rgba(0,200,150,.6)" }}
                  >
                    {s.n}
                  </div>
                  <hr className="rst-rule mb-6" />
                  <h3 className="font-heading font-semibold text-xl tracking-[-0.015em]">{s.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: "rgba(242,242,244,.56)" }}>
                    {s.desc}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing + lead form ─────────────────────────────── */}
      <section ref={formRef} className="relative max-w-6xl mx-auto px-5 sm:px-8 py-24 sm:py-32">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Offer */}
          <Reveal>
            <div>
              <h2
                className="font-heading font-bold tracking-[-0.03em]"
                style={{ fontSize: "clamp(2rem, 4.6vw, 3.2rem)" }}
              >
                $149<span style={{ color: "rgba(242,242,244,.40)", fontSize: "0.4em" }}> /month</span>
              </h2>
              <p className="mt-3 text-sm uppercase tracking-[0.18em]" style={{ color: "#d4af37" }}>
                Founding rate — locked for life
              </p>
              <p className="mt-6 leading-relaxed" style={{ color: "rgba(242,242,244,.62)" }}>
                We're taking twelve restaurants into the pilot. You get the founding price
                permanently, and a direct line to the person building it. First 30 days free —
                we don't take a card until you've seen it work in your room.
              </p>

              <ul className="mt-9 space-y-3">
                {PILOT_INCLUDES.map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <Check className="w-4 h-4 mt-1 flex-shrink-0" style={{ color: "#00c896" }} aria-hidden="true" />
                    <span className="text-sm" style={{ color: "rgba(242,242,244,.76)" }}>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          {/* Form */}
          <Reveal delay={0.1}>
            <div
              className="p-7 sm:p-9 rounded-3xl"
              style={{
                background: "linear-gradient(165deg, rgba(255,255,255,.045) 0%, rgba(255,255,255,.015) 100%)",
                border: "1px solid rgba(255,255,255,.09)",
                boxShadow: "0 40px 90px -50px rgba(0,0,0,.9)",
              }}
            >
              {status === "done" ? (
                <div className="py-10 text-center" role="status" aria-live="polite">
                  <div
                    className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-6"
                    style={{ background: "rgba(0,200,150,.12)", border: "1px solid rgba(0,200,150,.3)" }}
                  >
                    <Check className="w-7 h-7" style={{ color: "#00c896" }} aria-hidden="true" />
                  </div>
                  <h3 className="font-heading font-bold text-2xl tracking-[-0.02em]">You're on the list.</h3>
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: "rgba(242,242,244,.6)" }}>
                    We'll reach out within one business day to set up your table tents and walk
                    through the pilot. Questions before then — alerts@billtap.app.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate>
                  <h3 className="font-heading font-bold text-2xl tracking-[-0.02em]">Start free trial</h3>
                  <p className="mt-2 text-sm" style={{ color: "rgba(242,242,244,.52)" }}>
                    Takes about twenty seconds.
                  </p>

                  <div className="mt-7 space-y-4">
                    <div>
                      <label htmlFor="rst-name" className="block text-xs font-medium mb-2" style={{ color: "rgba(242,242,244,.62)" }}>
                        Restaurant name <span style={{ color: "#00c896" }}>*</span>
                      </label>
                      <input
                        id="rst-name" className="rst-field" type="text" autoComplete="organization"
                        placeholder="Rosewood Kitchen" value={form.restaurant_name}
                        onChange={set("restaurant_name")} required
                      />
                    </div>

                    <div>
                      <label htmlFor="rst-contact" className="block text-xs font-medium mb-2" style={{ color: "rgba(242,242,244,.62)" }}>
                        Your name
                      </label>
                      <input
                        id="rst-contact" className="rst-field" type="text" autoComplete="name"
                        placeholder="Alex Rivera" value={form.contact_name} onChange={set("contact_name")}
                      />
                    </div>

                    <div>
                      <label htmlFor="rst-email" className="block text-xs font-medium mb-2" style={{ color: "rgba(242,242,244,.62)" }}>
                        Email <span style={{ color: "#00c896" }}>*</span>
                      </label>
                      <input
                        id="rst-email" className="rst-field" type="email" autoComplete="email" inputMode="email"
                        placeholder="you@restaurant.com" value={form.email} onChange={set("email")} required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="rst-phone" className="block text-xs font-medium mb-2" style={{ color: "rgba(242,242,244,.62)" }}>
                          Phone
                        </label>
                        <input
                          id="rst-phone" className="rst-field" type="tel" autoComplete="tel" inputMode="tel"
                          placeholder="(555) 012-3456" value={form.phone} onChange={set("phone")}
                        />
                      </div>
                      <div>
                        <label htmlFor="rst-locations" className="block text-xs font-medium mb-2" style={{ color: "rgba(242,242,244,.62)" }}>
                          Locations
                        </label>
                        <select id="rst-locations" className="rst-field" value={form.locations} onChange={set("locations")}>
                          <option value="1" style={{ background: "#0a0e1a" }}>1</option>
                          <option value="2-5" style={{ background: "#0a0e1a" }}>2–5</option>
                          <option value="6-20" style={{ background: "#0a0e1a" }}>6–20</option>
                          <option value="20+" style={{ background: "#0a0e1a" }}>20+</option>
                        </select>
                      </div>
                    </div>

                    {/* Honeypot — hidden from people, catnip for bots. */}
                    <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", opacity: 0 }}>
                      <label htmlFor="rst-website">Company website</label>
                      <input
                        id="rst-website" type="text" tabIndex={-1} autoComplete="off"
                        value={form.company_website} onChange={set("company_website")}
                      />
                    </div>
                  </div>

                  {status === "error" && (
                    <p className="mt-4 text-sm" style={{ color: "#ff8080" }} role="alert">
                      {errorMsg}
                    </p>
                  )}

                  <button
                    type="submit" disabled={status === "loading"}
                    className="mt-7 w-full inline-flex items-center justify-center gap-2 font-semibold px-6 py-4 rounded-full transition-transform hover:scale-[1.015] disabled:opacity-60 disabled:hover:scale-100"
                    style={{ background: "#00c896", color: "#04231a", boxShadow: "0 18px 50px -22px rgba(0,200,150,.8)" }}
                  >
                    {status === "loading" ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        Sending
                      </>
                    ) : (
                      <>
                        Claim a founding spot
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </>
                    )}
                  </button>

                  <p className="mt-4 text-xs text-center leading-relaxed" style={{ color: "rgba(242,242,244,.38)" }}>
                    We'll only use this to talk to you about the pilot. No lists, no resale.
                  </p>
                </form>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <p className="text-sm" style={{ color: "rgba(242,242,244,.38)" }}>
            © {new Date().getFullYear()} BillTap
          </p>
          <div className="flex gap-6 text-sm">
            <Link to="/" style={{ color: "rgba(242,242,244,.55)" }}>Consumer app</Link>
            <Link to="/privacy" style={{ color: "rgba(242,242,244,.55)" }}>Privacy</Link>
            <Link to="/terms" style={{ color: "rgba(242,242,244,.55)" }}>Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

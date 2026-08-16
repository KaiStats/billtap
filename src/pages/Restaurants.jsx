import { useState, useRef, useEffect } from "react";
import { Link } from "react-router";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import {
  ArrowRight, Check, X, Star, Bell, Mail, BarChart3, Smartphone,
  Zap, ThumbsUp, Cpu, Clock, Phone, Loader2,
} from "lucide-react";
import Seo from "@/components/Seo";
import { art, artSrcSet, artSizes } from "@/lib/restaurant-assets";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GOLD = "#f0b429";
const INK = "#0b0b0d";

const PILLARS = [
  {
    icon: Bell,
    tone: "#e5484d",
    img: "pillar-alert",
    alt: "A restaurant owner on the dining room floor checking an alert on her phone mid-service.",
    // Was "Stop 1-star reviews before they happen", which described a product
    // that withheld the Google link from unhappy guests. It no longer does, and
    // the honest version of this line is the better one anyway: an operator can
    // print it, say it out loud, and put it in a marketplace application.
    kicker: "While they're still at the table",
    title: "Hear it before they walk out",
    desc: "Real-time alert the moment a guest rates you low — while a manager can still walk over and fix it in person.",
  },
  {
    icon: Star,
    tone: GOLD,
    img: "pillar-reviews",
    alt: "A guest's hand tapping a star rating on their phone over a table set with dessert and wine.",
    kicker: "One tap, no asking",
    title: "Generate more Google reviews",
    desc: "Every guest gets a one-tap route to your listing the second they finish paying. No staff asking.",
  },
  {
    icon: Mail,
    tone: "#30a46c",
    img: "pillar-list",
    alt: "A long communal table full of guests dining together by candlelight.",
    kicker: "Every service",
    title: "Build a customer list every night",
    desc: "Guests opt in at checkout. Those emails become your list — for promos, events, and bringing them back.",
  },
  {
    icon: BarChart3,
    tone: "#3b82f6",
    img: "pillar-report",
    alt: "An owner sitting alone at the bar after close, reviewing the night on his phone.",
    kicker: "Once a month",
    title: "Know exactly how you're performing",
    desc: "Monthly email report: average rating, new contacts, reviews captured. No dashboards, no homework.",
  },
];

const BULLETS = [
  { icon: Smartphone, img: "strip-scan", title: "No app to download", desc: "Just scan and go.", alt: "A phone scanning a QR table tent on a restaurant table." },
  // "about", because the step below already says about and a bare "in 30
  // seconds" reads as a measurement rather than a description. Nothing has
  // timed a real table yet.
  { icon: Zap, img: "strip-split", title: "Split & pay in about 30 seconds", desc: "Fast, simple, frictionless.", alt: "Two friends splitting a paper check with their phones." },
  { icon: ThumbsUp, img: "strip-rate", title: "Rate you on Google instantly", desc: "Good experiences get shared.", alt: "A thumb pressing a glowing phone screen." },
  { icon: Mail, img: "strip-data", title: "You get the data & reviews", desc: "More customers. More revenue.", alt: "A phone lighting up with a notification on a bar counter." },
  { icon: Cpu, img: "strip-pos", title: "Works with your POS", desc: "No new hardware. No disruption.", alt: "A card payment terminal on a polished bar counter." },
  { icon: Clock, img: "strip-setup", title: "Setup in under 10 minutes", desc: "We do the heavy lifting.", alt: "A server placing a QR table tent onto a freshly set table." },
];

const PERFECT_FOR = [
  "Steakhouses", "Mexican Restaurants", "Sushi", "BBQ",
  "Breweries", "Sports Bars", "Family Restaurants",
];

const WITHOUT = ["Missed reviews", "Lost customer emails", "Surprise 1-star reviews", "No guest insights", "Harder to grow"];
const WITH = ["More 5-star reviews", "Build your customer list", "Instant bad-experience alerts", "Know your numbers", "More repeat customers"];

const STEPS = [
  { n: "01", img: "step-scan", title: "Guests scan a QR on the table", desc: "No app needed.", alt: "Friends at a table, one leaning in to scan the QR table tent." },
  { n: "02", img: "step-split", title: "They split the check", desc: "Everyone's share in about 30 seconds. You still get paid the way you always have.", alt: "Four friends laughing as they settle the bill on their phones." },
  { n: "03", img: "step-rate", title: "They rate you", desc: "Everyone gets your Google link. A low rating pings you instantly.", alt: "A satisfied guest smiling as she rates the meal on her phone." },
];

/**
 * Image that fades up once decoded, and removes itself on error so the
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
      // Both null until the art is self-hosted — the CDN only has the one
      // full-size original, so a single-entry srcset would be noise. Once
      // scripts/fetch-art.mjs has run, the browser picks the
      // smallest file that covers the slot instead of the 2400px original.
      srcSet={artSrcSet(name) || undefined}
      sizes={artSizes(name) || undefined}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      // The hero is the LCP element. Without this it queues behind the JS
      // chunks at default priority and the largest paint waits on it.
      fetchPriority={eager ? "high" : "low"}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={(e) => { e.currentTarget.style.display = "none"; }}
      className={`rst-img rst-grade ${loaded ? "is-loaded" : ""} ${className}`}
      style={/** @type {any} */ ({ "--to": to, objectPosition: position })}
    />
  );
}

/** @param {{ children?: any, delay?: any, className?: any, [key: string]: any }} props */
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

    // The alert is now the whole of the save.
    //
    // This used to write a RestaurantLead row from the browser and treat the
    // email as a nicety on top. The row went to Base44 and there is nothing
    // writing one now — so the notification is the lead, and it is checked
    // rather than fired and forgotten. A lead that produces neither a row nor
    // an email is a restaurant that filled in a form and never heard back.
    try {
      const res = await fetch("/api/restaurant-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`restaurant-lead responded ${res.status}`);
    } catch {
      setErrorMsg("Couldn't save that. Call (702) 844-0938 and we'll set you up by hand.");
      setStatus("error");
      return;
    }

    if (typeof window.fbq === "function") window.fbq("trackCustom", "RestaurantLead");
    if (typeof window.gtag === "function") window.gtag("event", "generate_lead", { value: 149, currency: "USD" });
    setStatus("done");
  };

  return (
    <div className="min-h-screen font-body" style={{ background: INK, color: "#f5f5f4" }}>
      <Seo
        path="/restaurants"
        title="More Google Reviews for Your Restaurant | BillTap"
        description="Guests split the check from a QR code on the table, then rate you. Every guest gets a one-tap route to your Google listing, and a low rating alerts you while they're still there. 14-day free trial, $149/month."
        image="https://billtap.app/img/og-restaurants.png"
        schema={[
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "BillTap for Restaurants",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            description: "Guest bill-splitting that captures Google reviews and customer contact info at the moment of payment, with a real-time alert to owners on low ratings.",
            url: "https://billtap.app/restaurants",
            offers: {
              "@type": "Offer",
              price: "149",
              priceCurrency: "USD",
              eligibleDuration: { "@type": "QuantitativeValue", value: "14", unitCode: "DAY" },
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: [
              {
                "@type": "Question",
                name: "Does BillTap replace my POS?",
                acceptedAnswer: { "@type": "Answer", text: "No. BillTap runs alongside whatever POS you already use \u2014 Toast, Clover, Square, or anything else. There's no integration, no new hardware, and no changes to how your kitchen or servers ring in orders." },
              },
              {
                "@type": "Question",
                name: "What does my staff have to do differently?",
                acceptedAnswer: { "@type": "Answer", text: "Nothing. Guests scan a QR code at the table, split and pay on their own phones, and rate their visit without a server involved. The only new step is putting a table tent out." },
              },
              {
                "@type": "Question",
                name: "Where do the 5-star reviews actually go?",
                acceptedAnswer: { "@type": "Answer", text: "Straight to your Google Business Profile. A happy guest gets a one-tap link to leave a review the moment they finish paying." },
              },
              {
                "@type": "Question",
                name: "What happens if a guest leaves a bad rating?",
                acceptedAnswer: { "@type": "Answer", text: "Every guest gets the same Google review link \u2014 BillTap doesn't gate or hide reviews by rating. A low rating instead triggers a real-time alert to the owner while the guest is still at the table, so a manager can address it in person." },
              },
              {
                "@type": "Question",
                name: "Can I cancel anytime?",
                acceptedAnswer: { "@type": "Answer", text: "Yes. BillTap offers a 14-day free trial, and the $149/month plan can be canceled anytime with no contract and no cancellation fee." },
              },
              {
                "@type": "Question",
                name: "Does BillTap handle any of the money?",
                acceptedAnswer: { "@type": "Answer", text: "None of it. Your guests pay you exactly the way they do now. BillTap splits the check on their phones so each person knows their share, and tracks who has settled up with whoever is covering the bill. No money moves through BillTap, so there is no merchant account to open, no payout schedule, and nothing extra to reconcile at close." },
              },
            ],
          },
        ]}
      />
      <style>{`

        .font-display { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; }
        .font-body    { font-family: 'Inter Tight', system-ui, sans-serif; }
        .font-mono    { font-family: 'JetBrains Mono', ui-monospace, monospace; }

        /*
          Eyebrow / micro-label: the one place we use caps + wide tracking.

          12px on a phone, 10px from the sm breakpoint up. Ten was chosen for a desktop
          canvas and carried straight down: on a 390px screen the hero's label
          — "Guests split the bill free — you get the reviews", the first line
          of copy an owner reads — wrapped onto two lines at a size that is
          hard work in a dim restaurant. Caps and .2em tracking cost legibility
          on top of the size, which is why this is the one label that needs the
          bump rather than a site-wide change.

          Tracking eases slightly with it. At 12px, .2em is enough to break a
          short phrase into something you read letter by letter.
        */
        .rst-eyebrow {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 12px; text-transform: uppercase; letter-spacing: .14em;
        }
        @media (min-width: 640px) {
          .rst-eyebrow { font-size: 10px; letter-spacing: .2em; }
        }

        .rst-grain::after {
          content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .26;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E");
          mix-blend-mode: overlay;
        }

        /* One grade across every frame so fifteen separate renders read as one shoot. */
        .rst-grade { filter: saturate(.88) contrast(1.06) brightness(.94); }

        .rst-img { opacity: 0; transition: opacity .9s ease, transform 1.2s cubic-bezier(.16,1,.3,1); }
        .rst-img.is-loaded { opacity: var(--to, 1); }

        .rst-card {
          background: linear-gradient(168deg, rgba(255,255,255,.055), rgba(255,255,255,.012));
          border: 1px solid rgba(255,255,255,.09);
          border-radius: 14px;
          transition: border-color .4s ease, transform .5s cubic-bezier(.16,1,.3,1);
        }
        .rst-card:hover { border-color: rgba(240,180,41,.28); }
        .rst-card:hover .rst-zoom { transform: scale(1.045); }

        .rst-cell:hover .rst-img { --to: .5; }

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

        @keyframes rst-kenburns { from { transform: scale(1.04); } to { transform: scale(1.13); } }
        .rst-kb { animation: rst-kenburns 28s ease-in-out infinite alternate; transform-origin: 62% 40%; }

        @media (prefers-reduced-motion: reduce) {
          html { scroll-behavior:auto; }
          .rst-kb { animation: none; }
          .rst-img { transition: none; }
        }
      `}</style>

      {/* ── Nav ─────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl"
        style={{ background: "rgba(11,11,13,.8)", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: GOLD }}>
              <span className="font-black text-sm" style={{ color: INK }}>B</span>
            </div>
            <span className="font-display text-xl tracking-tight" style={{ color: "#f5f5f4" }}>BillTap</span>
            <span className="hidden sm:inline rst-eyebrow px-2 py-1 rounded-full"
              style={{ background: "rgba(240,180,41,.1)", color: GOLD, border: "1px solid rgba(240,180,41,.25)" }}>
              For Restaurants
            </span>
          </Link>
          <button onClick={scrollToForm}
            className="text-sm font-semibold px-4 py-2 rounded-full transition-transform hover:scale-[1.03]"
            style={{ background: GOLD, color: INK }}>
            Start free trial
          </button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────── */}
      <header ref={heroRef} className="relative overflow-hidden rst-grain"
        style={{ minHeight: "clamp(660px, 98vh, 940px)" }}>
        <motion.div className="absolute inset-0" style={{ y: heroY, opacity: heroFade }}>
          <div className="absolute inset-0 overflow-hidden">
            <Img name="hero" alt="" eager to={1} position="62% 40%"
              className="rst-kb absolute inset-0 w-full h-full object-cover" />
          </div>
          <div className="absolute inset-0" aria-hidden="true"
            style={{
              background:
                "radial-gradient(120% 85% at 74% 26%, rgba(240,180,41,.16) 0%, transparent 56%), linear-gradient(180deg, rgba(11,11,13,.62) 0%, rgba(11,11,13,.82) 44%, " + INK + " 96%)",
            }} />
        </motion.div>

        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 flex flex-col justify-center"
          style={{ minHeight: "clamp(660px, 98vh, 940px)" }}>
          <div className="pt-24 pb-16 max-w-3xl">
            <Reveal>
              <div className="inline-flex items-center gap-2 rst-eyebrow px-3 py-1.5 rounded-full mb-8"
                style={{ background: "rgba(240,180,41,.1)", color: GOLD, border: "1px solid rgba(240,180,41,.3)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: GOLD }} />
                Guests split the bill free — you get the reviews
              </div>
            </Reveal>

            <Reveal delay={0.06}>
              {/* Sans for the claim, serif italic for the promise — the mix is the signature. */}
              <h1 className="leading-[0.94]" style={{ fontSize: "clamp(2.5rem, 6.6vw, 4.9rem)" }}>
                <span className="font-body font-semibold tracking-[-0.04em] block">
                  Turn every split check into
                </span>
                <span className="font-display italic block mt-1" style={{
                  fontSize: "1.12em",
                  background: "linear-gradient(100deg, #f0b429 0%, #ffd97a 45%, #e0952a 100%)",
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                }}>
                  more 5-star reviews.
                </span>
              </h1>
            </Reveal>

            <Reveal delay={0.12}>
              <p className="mt-8 text-lg sm:text-xl leading-relaxed max-w-xl font-light"
                style={{ color: "rgba(245,245,244,.74)" }}>
                The easiest way to increase Google reviews, build your customer list, and
                catch unhappy guests <em className="font-display not-italic" style={{ color: "#fff", fontSize: "1.12em" }}>before they leave</em>.
              </p>
            </Reveal>

            <Reveal delay={0.18}>
              <div className="mt-10 flex flex-col sm:flex-row gap-3 sm:items-center">
                <button onClick={scrollToForm}
                  className="group inline-flex items-center justify-center gap-2 font-semibold px-7 py-4 rounded-full transition-transform hover:scale-[1.02]"
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
      <section className="relative max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-28">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.07} className="h-full">
              <article className="group h-full flex flex-col overflow-hidden rst-card">
                <div className="relative overflow-hidden" style={{ aspectRatio: "3 / 2" }}>
                  {/* Gradient sits underneath, so a failed image still looks composed. */}
                  <div className="absolute inset-0" aria-hidden="true"
                    style={{ background: `linear-gradient(150deg, ${p.tone}22 0%, rgba(11,11,13,.9) 70%)` }} />
                  <Img name={p.img} alt={p.alt}
                    className="rst-zoom absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-0" aria-hidden="true"
                    style={{ background: "linear-gradient(180deg, rgba(11,11,13,.1) 40%, rgba(11,11,13,.92) 100%)" }} />
                  <div className="absolute left-5 -bottom-5 w-10 h-10 rounded-xl flex items-center justify-center backdrop-blur-md"
                    style={{ background: `${p.tone}26`, border: `1px solid ${p.tone}55` }}>
                    <p.icon className="w-[18px] h-[18px]" style={{ color: p.tone }} aria-hidden="true" />
                  </div>
                </div>

                <div className="flex-1 p-6 pt-9">
                  <p className="rst-eyebrow mb-3" style={{ color: `${p.tone}cc` }}>{p.kicker}</p>
                  {/* h2, not h3: these are the page's top-level claims and sit
                      directly under the h1 with no intervening section heading. */}
                  <h2 className="font-display text-[1.4rem] leading-[1.12] tracking-[-0.005em]">{p.title}</h2>
                  <p className="mt-3 text-sm leading-relaxed font-light" style={{ color: "rgba(245,245,244,.6)" }}>{p.desc}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        {/* Trust strip — every cell carries its own frame */}
        <Reveal delay={0.1}>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px rounded-2xl overflow-hidden"
            style={{ background: "rgba(240,180,41,.16)", border: "1px solid rgba(240,180,41,.3)" }}>
            {BULLETS.map((b) => (
              <div key={b.title} className="rst-cell group relative overflow-hidden"
                style={{ background: INK, minHeight: 188 }}>
                <Img name={b.img} alt={b.alt} to={0.34}
                  className="rst-zoom absolute inset-0 w-full h-full object-cover" />
                <div className="absolute inset-0" aria-hidden="true"
                  style={{ background: "linear-gradient(180deg, rgba(11,11,13,.5) 0%, rgba(11,11,13,.93) 100%)" }} />
                <div className="relative h-full p-5 flex flex-col justify-end">
                  <b.icon className="w-4 h-4 mb-3" style={{ color: GOLD }} aria-hidden="true" />
                  <p className="rst-eyebrow leading-[1.5]" style={{ color: "#f5f5f4" }}>{b.title}</p>
                  <p className="mt-2 text-xs font-light" style={{ color: "rgba(245,245,244,.55)" }}>{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── Without / With ──────────────────────────────────── */}
      <section className="relative max-w-6xl mx-auto px-5 sm:px-8 pb-20 sm:pb-28">
        <div className="grid lg:grid-cols-3 gap-6">
          <Reveal>
            <div className="relative h-full overflow-hidden rst-card">
              <Img name="strip-setup" alt="" to={0.16}
                className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0" aria-hidden="true"
                style={{ background: "linear-gradient(180deg, rgba(11,11,13,.82) 0%, rgba(11,11,13,.97) 70%)" }} />
              <div className="relative p-7">
                <h3 className="font-display text-2xl" style={{ color: GOLD }}>Perfect for</h3>
                <ul className="mt-5 space-y-2.5">
                  {PERFECT_FOR.map((t) => (
                    <li key={t} className="text-sm font-light" style={{ color: "rgba(245,245,244,.8)" }}>{t}</li>
                  ))}
                </ul>
                <hr className="rst-rule my-6" />
                <p className="text-sm leading-relaxed font-light" style={{ color: "rgba(245,245,244,.6)" }}>
                  Built for independent restaurants that want more repeat customers
                  without changing their POS.
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.08} className="lg:col-span-2">
            <div className="h-full grid sm:grid-cols-2 gap-4">
              <div className="p-7 rounded-2xl" style={{ background: "rgba(229,72,77,.06)", border: "1px solid rgba(229,72,77,.22)" }}>
                <h3 className="rst-eyebrow" style={{ color: "#e5484d" }}>Without BillTap</h3>
                <ul className="mt-5 space-y-3">
                  {WITHOUT.map((t) => (
                    <li key={t} className="flex items-start gap-2.5 text-sm font-light" style={{ color: "rgba(245,245,244,.72)" }}>
                      <X className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#e5484d" }} aria-hidden="true" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-7 rounded-2xl" style={{ background: "rgba(48,164,108,.07)", border: "1px solid rgba(48,164,108,.25)" }}>
                <h3 className="rst-eyebrow" style={{ color: "#30a46c" }}>With BillTap</h3>
                <ul className="mt-5 space-y-3">
                  {WITH.map((t) => (
                    <li key={t} className="flex items-start gap-2.5 text-sm font-light" style={{ color: "rgba(245,245,244,.85)" }}>
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
      <section className="relative py-14 sm:py-28" style={{ background: "linear-gradient(180deg, #0b0b0d 0%, #131315 50%, #0b0b0d 100%)" }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <Reveal>
            <p className="rst-eyebrow mb-4" style={{ color: GOLD }}>Three steps</p>
            <h2 className="font-display" style={{ fontSize: "clamp(2.1rem, 4.8vw, 3.4rem)", lineHeight: 1.05 }}>
              How it works
            </h2>
          </Reveal>

          <div className="mt-12 grid sm:grid-cols-3 gap-6 sm:gap-8">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.1}>
                <div className="group">
                  <div className="relative overflow-hidden rounded-xl" style={{ aspectRatio: "3 / 2" }}>
                    <div className="absolute inset-0" aria-hidden="true"
                      style={{ background: "linear-gradient(150deg, rgba(240,180,41,.14), rgba(11,11,13,.9) 70%)" }} />
                    <Img name={s.img} alt={s.alt}
                      className="rst-zoom absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0" aria-hidden="true"
                      style={{ background: "linear-gradient(180deg, rgba(11,11,13,0) 45%, rgba(11,11,13,.88) 100%)" }} />
                    {/* Oversized serif numeral, set into the frame rather than above it. */}
                    <span className="font-display absolute left-4 bottom-1 leading-none select-none"
                      style={{ fontSize: "3.6rem", color: GOLD, opacity: .92 }} aria-hidden="true">
                      {s.n}
                    </span>
                  </div>
                  <h3 className="mt-5 font-display text-[1.35rem] leading-tight">{s.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed font-light" style={{ color: "rgba(245,245,244,.58)" }}>{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.3}>
            <div className="mt-14 relative rounded-2xl overflow-hidden rst-grain"
              style={{ background: "linear-gradient(150deg, #1b1a17 0%, #0b0b0d 70%)", border: "1px solid rgba(255,255,255,.08)", minHeight: 260 }}>
              <Img name="band" alt="" to={0.62} position="70% 50%"
                className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0" aria-hidden="true"
                style={{ background: "linear-gradient(90deg, rgba(11,11,13,.96) 26%, rgba(11,11,13,.35) 100%)" }} />
              <div className="relative p-8 sm:p-12 max-w-md flex flex-col justify-center" style={{ minHeight: 260 }}>
                <p className="font-display text-[1.9rem] leading-[1.1]">Your staff does nothing differently.</p>
                <p className="mt-4 text-sm leading-relaxed font-light" style={{ color: "rgba(245,245,244,.64)" }}>
                  The table tent does the work. No new hardware, no POS change, live in minutes.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Pricing + form ──────────────────────────────────── */}
      <section ref={formRef} className="relative max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-28">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          <Reveal>
            <div>
              <p className="rst-eyebrow" style={{ color: GOLD }}>Plans that pay for themselves</p>
              <h2 className="mt-4 font-display leading-none" style={{ fontSize: "clamp(3rem, 6.4vw, 4.4rem)" }}>
                $149<span className="font-body font-light" style={{ color: "rgba(245,245,244,.4)", fontSize: "0.28em" }}>/month</span>
              </h2>
              <p className="mt-5 leading-relaxed font-light" style={{ color: "rgba(245,245,244,.66)" }}>
                Pays for itself with just one or two additional returning tables each month.
              </p>

              <ul className="mt-8 space-y-3">
                {["14-day free trial", "Cancel anytime", "Printed QR table tents included",
                  "Unlimited tables and covers", "Setup in under 10 minutes",
                  "No merchant account \u2014 your money never passes through us"].map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <Check className="w-4 h-4 mt-1 flex-shrink-0" style={{ color: GOLD }} aria-hidden="true" />
                    <span className="text-sm font-light" style={{ color: "rgba(245,245,244,.8)" }}>{f}</span>
                  </li>
                ))}
              </ul>

              <hr className="rst-rule my-8" />
              <p className="rst-eyebrow" style={{ color: GOLD }}>Questions? Let's talk.</p>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
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
                  <h3 className="font-display text-3xl">You're in.</h3>
                  <p className="mt-3 text-sm leading-relaxed font-light" style={{ color: "rgba(245,245,244,.62)" }}>
                    We'll call within one business day to get your table tents printed and
                    your trial switched on. Sooner is fine too — (702) 844-0938.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate>
                  <h3 className="font-display text-3xl leading-tight">Start your free trial</h3>
                  <p className="mt-2 text-sm font-light" style={{ color: "rgba(245,245,244,.54)" }}>
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
                    className="mt-7 w-full inline-flex items-center justify-center gap-2 font-semibold px-6 py-4 rounded-full transition-transform hover:scale-[1.015] disabled:opacity-60 disabled:hover:scale-100"
                    style={{ background: GOLD, color: INK, boxShadow: "0 18px 50px -22px rgba(240,180,41,.85)" }}>
                    {status === "loading"
                      ? (<><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Sending</>)
                      : (<>Start my free trial<ArrowRight className="w-4 h-4" aria-hidden="true" /></>)}
                  </button>

                  <p className="mt-4 text-xs text-center leading-relaxed font-light" style={{ color: "rgba(245,245,244,.4)" }}>
                    We'll only use this to talk to you about your trial. No lists, no resale.
                  </p>
                </form>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      {/* ── Proof ──────────────────────────────────────
          ── What was here, and why it had to go ─────────────────────────────

          This section named a real restaurant — "Mariposa | Cocina & Cocktails
          runs BillTap every service" — under the heading "Live in Las Vegas",
          beside "taking real tables today" and "30 sec average time to split &
          pay". Mariposa is not a customer. They are a prospect who has not said
          yes, and the comment that used to sit here claimed the section carried
          "deliberately no invented numbers" while the thirty seconds was
          invented and the customer was too.

          Three separate reasons it could not stay, in the order they bite:

          The owner can read this page. He is being pitched. Finding his
          restaurant already listed as a paying customer is the end of that
          conversation and probably of the relationship, and he would be right.

          Naming a business as a customer when it is not is a false endorsement.
          The FTC's rule on endorsements is about exactly this, and it does not
          care that the intent was optimism about a deal expected to close.

          And it is the one thing this product cannot be caught doing. BillTap's
          pitch is that it gets a restaurant honest reviews from real guests. A
          page that manufactures its own social proof is selling review
          integrity while faking its own.

          ── What replaced it ────────────────────────────────────────────────

          Only claims that are true on the day they are read. The price is the
          real price. The trial length is TRIAL_DAYS in worker/routes/
          functions.js. "Founder-led" is a fact about a company of one.

          There is no customer count here, and there should not be one until
          there is a customer who agreed to be named. When that happens the
          numbers to put here are the ones the dashboard already computes —
          reviews captured, contacts collected, low ratings caught — pulled from
          a real account, with permission. Not before. */}
      <section id="proof" className="py-16 sm:py-20" style={{ borderTop: "1px solid rgba(255,255,255,.07)" }}>
        <div className="max-w-4xl mx-auto px-5 sm:px-8 text-center">
          <span className="rst-eyebrow inline-block px-3 py-1.5 rounded-full mb-6"
            style={{ background: "rgba(240,180,41,.1)", color: GOLD, border: "1px solid rgba(240,180,41,.25)" }}>
            Built in Las Vegas
          </span>
          <p className="font-display text-2xl sm:text-3xl leading-snug" style={{ color: "#f5f5f4" }}>
            No customer logos yet — you&apos;d be the first.
          </p>
          <p className="mt-4 text-base leading-relaxed max-w-xl mx-auto" style={{ color: "rgba(245,245,244,.62)" }}>
            BillTap is built and running today. It is not yet in a dining room, and
            this page is not going to pretend otherwise. Being first means the
            founder answers the phone.
          </p>
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6">
            {[
              { n: "$149", l: "flat monthly, no contract" },
              { n: "14 days", l: "free trial, no card up front" },
              { n: "Founder-led", l: "you deal with the person who built it" },
            ].map((s) => (
              <div key={s.l}>
                <div className="font-display text-3xl sm:text-4xl" style={{ color: GOLD }}>{s.n}</div>
                <div className="mt-1.5 text-sm" style={{ color: "rgba(245,245,244,.58)" }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────
          Plain stacked Q&A, not an accordion — matches Seo.jsx's own
          "dependency-free by design" stance: no new state, no new imports for
          something five owners standing at a host stand will just read once. */}
      <section id="faq" className="py-16 sm:py-20" style={{ background: "rgba(255,255,255,.02)" }}>
        <div className="max-w-3xl mx-auto px-5 sm:px-8">
          <h2 className="font-display text-3xl sm:text-4xl text-center mb-12" style={{ color: "#f5f5f4" }}>
            Questions owners actually ask
          </h2>
          <div className="space-y-8">
            {[
              {
                q: "Does BillTap replace my POS?",
                a: "No. BillTap runs alongside whatever you already use \u2014 Toast, Clover, Square, anything. There's no integration, no new hardware, and no changes to how your kitchen or servers ring in orders.",
              },
              {
                q: "What does my staff have to do differently?",
                a: 'Nothing. Guests scan a QR code at the table, split and pay on their own phones, and rate their visit \u2014 all without a server involved. The only "new" step is putting a table tent out, and we send you those.',
              },
              {
                q: "Where do the 5-star reviews actually go?",
                a: "Straight to your Google Business Profile \u2014 the same place customers already look you up. A happy guest gets a one-tap link the moment they finish paying.",
              },
              {
                q: "What happens if a guest leaves a bad rating?",
                a: "Every guest gets the same Google link \u2014 nothing is gated or hidden by rating. A low rating instead triggers a real-time alert to you while the guest is still at the table, so a manager can walk over and make it right in person.",
              },
              {
                q: "Can I cancel anytime?",
                a: "Yes. Start with a 14-day free trial, and once you're on the $149/mo plan you can cancel whenever \u2014 no contract, no cancellation fee.",
              },
              {
                q: "Does BillTap handle any of the money?",
                a: "None of it. Your guests pay you exactly the way they do now. BillTap splits the check on their phones so everyone knows their share, and tracks who has settled up with whoever is covering the bill. Nothing moves through us \u2014 no merchant account to open, no payout schedule, nothing extra to reconcile at close.",
              },
            ].map((item) => (
              <div key={item.q}>
                <p className="font-semibold text-lg" style={{ color: "#f5f5f4" }}>{item.q}</p>
                <p className="mt-2 leading-relaxed" style={{ color: "rgba(245,245,244,.64)" }}>{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,.07)" }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12">
          <p className="font-display text-2xl" style={{ color: GOLD }}>
            More Reviews. More Customers. More Revenue.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <p className="text-sm font-light" style={{ color: "rgba(245,245,244,.4)" }}>© {new Date().getFullYear()} BillTap</p>
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

import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { Check, QrCode, Camera, Users, Shield, Smartphone, CreditCard, Zap, FileText, Lock, ArrowRight, ScanLine } from "lucide-react";
import Seo from "@/components/Seo";
import { accessToken } from "@/lib/supabase";
import { art, artSrcSet, artSizes, video, videoPoster, VIDEO_MANIFEST } from "@/lib/landing-assets";

/*
 * ── Direction contract ────────────────────────────────────────────────────
 * THESIS: "The bill, already divided." The category ships a stock-photo hero
 *   plus icon-card feature grid; this refuses both — the first viewport IS an
 *   itemized receipt settling itself, in ledger type.
 * OWN-WORLD: Ledger at midnight — deep navy ground (#070b16), one electric-teal
 *   action colour, JetBrains Mono for every number, Inter Tight display, hairline
 *   borders, a single teal aurora. No gradient text, no eyebrow labels, no
 *   same-size icon cards as scaffold.
 * STORY: A diner sees the math already done, understands there's no app and no
 *   account, and taps "Split a bill now" → /new-receipt.
 * FIRST VIEWPORT: Left — H1 "Scan. Split. Settled.", subhead, primary + ghost
 *   CTAs, no-app/no-account/free proof row. Right — a phone rendering a live
 *   itemized split with per-person claims and a running "you owe" in mono.
 * FORM: Product-demonstration landing; the mechanism is dramatized, not claimed.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 *   finish review, the verdict, and DESIGN.md.
 */

/**
 * The product demo, framed as a phone because the clip is 9:16.
 *
 * Does not autoplay. The video shows with a poster frame and visible controls,
 * and the user taps to play. This keeps the 10.5MB clip off the critical path —
 * the fetch happens only when the user chooses to play, not on page load. The
 * poster is already on the page as step-photo, so a real frame paints
 * immediately even before the user taps.
 *
 * `preload="none"` still applies: metadata only, no frames, until play.
 */
/** @param {{ name?: any, className?: any, [key: string]: any }} props */
function DemoVideo({ name, className = "" }) {
  const src = video(name);
  const entry = VIDEO_MANIFEST[name];

  if (!src || !entry) return null;

  return (
    <video
      className={className}
      style={{ aspectRatio: entry.aspect, width: "100%", display: "block", objectFit: "cover" }}
      src={src}
      poster={videoPoster(name) || undefined}
      muted
      playsInline
      controls
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
        <QrCode className="text-[#070b16]" style={{ width: size * 0.62, height: size * 0.62 }} />
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

/**
 * Counts a number up to `target` once, on mount, over `duration` ms with an
 * exponential ease-out — the fintech "total landing" tick. Honours reduced
 * motion by snapping straight to the value, and only runs when the element is
 * actually on screen so it isn't already finished by the time it scrolls in.
 * @returns {[number, import("react").RefObject<any>]}
 */
function useCountUp(target, duration = 1100) {
  const [value, setValue] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !el) { setValue(target); return; }
    let raf, start;
    let started = false;
    const run = (t) => {
      if (start == null) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(target * eased);
      if (p < 1) raf = requestAnimationFrame(run);
    };
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started) { started = true; raf = requestAnimationFrame(run); io.disconnect(); }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [target, duration]);
  return [value, ref];
}

/**
 * The hero's thesis object: a phone rendering a real itemized split, settling
 * itself in front of the visitor. Rows drop into the ledger one by one, each
 * claim mark pops as it lands, and the share total ticks up — the mechanism
 * (dinner, already divided) shown rather than described. True ledger type, not
 * a screenshot, so it stays crisp at any density.
 */
function SplitReceipt() {
  const items = [
    { who: "You", tint: "#00c896", item: "Cacio e pepe", price: "18.00", mine: true },
    { who: "M", tint: "#38bdf8", item: "Negroni", price: "14.00" },
    { who: "J", tint: "#f59e0b", item: "Burrata", price: "16.00" },
    { who: "You", tint: "#00c896", item: "Sparkling water", price: "5.80", mine: true },
  ];
  const [total, totalRef] = useCountUp(28);
  return (
    <div className="relative w-[300px] max-w-full">
      {/* one teal glow, offset so it reads as light not a flat halo */}
      <div aria-hidden="true" className="absolute -inset-10 -z-10 rounded-[3rem]" style={{ background: "radial-gradient(60% 55% at 50% 30%, rgba(0,200,150,0.22), transparent 70%)" }} />
      <div className="glass-strong rounded-[2rem] p-3 shadow-float">
        <div className="rounded-[1.5rem] bg-[#0a1120] ring-hairline overflow-hidden">
          {/* status strip */}
          <div className="flex items-center gap-2 px-5 pt-4 pb-3">
            <span className="w-2 h-2 rounded-full bg-primary pulse-teal" />
            <span className="text-[11px] font-medium text-muted-foreground">billtap.app/claim · live</span>
            <span className="ml-auto text-[11px] font-semibold text-primary">4 of 6 settled</span>
          </div>
          {/* header */}
          <div className="px-5 pb-4">
            <p className="font-display text-lg font-semibold text-foreground leading-tight">Trattoria No. 9</p>
            <p className="text-xs text-muted-foreground">Table for 6 · Fri 8:14pm</p>
          </div>
          <div className="h-px bg-border/70" />
          {/* line items — each settles in, then its claim mark pops */}
          <div className="px-3 py-2">
            {items.map((it, i) => (
              <div key={i} className={`animate-settle flex items-center gap-3 rounded-xl px-2.5 py-2 ${it.mine ? "bg-primary/[0.06]" : ""}`} style={{ animationDelay: `${0.25 + i * 0.14}s` }}>
                <span className="grid place-items-center w-7 h-7 rounded-full text-[11px] font-bold shrink-0" style={{ background: `${it.tint}22`, color: it.tint, boxShadow: `inset 0 0 0 1px ${it.tint}55` }}>
                  {it.who === "You" ? "Y" : it.who}
                </span>
                <span className={`text-sm truncate ${it.mine ? "text-foreground font-medium" : "text-muted-foreground"}`}>{it.item}</span>
                <span className="ml-auto mono text-sm text-foreground/90 tabular-nums">${it.price}</span>
                <Check className="animate-pop w-3.5 h-3.5 shrink-0" style={{ color: it.tint, animationDelay: `${0.45 + i * 0.14}s` }} aria-hidden="true" />
              </div>
            ))}
          </div>
          <div className="h-px bg-border/70" />
          {/* prorated tax + tip */}
          <div className="px-5 py-3 space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Tax + tip, prorated</span>
              <span className="mono tabular-nums">+ $4.20</span>
            </div>
          </div>
          {/* your total — ticks up as the split lands */}
          <div className="mx-3 mb-3 rounded-xl bg-primary/[0.08] ring-hairline px-4 py-3 flex items-end justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Your share</p>
              <p className="text-xs text-muted-foreground">2 items · settle with Venmo</p>
            </div>
            <p ref={totalRef} className="mono text-2xl font-semibold text-primary tabular-nums leading-none">${total.toFixed(2)}</p>
          </div>
        </div>
      </div>
    </div>
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

  // One orchestrated lift per section: every [data-reveal] rises once as it
  // enters the viewport. A single observer for the whole page rather than one
  // per element, and it disconnects each target after it fires so a fast
  // scroller never re-triggers or catches a blank. CSS handles reduced motion.
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll("[data-reveal]"));
    if (!targets.length) return;
    // The hidden start is armed by CSS (@media scripting: enabled); the observer
    // just adds is-in as each target enters, and IO fires immediately for any
    // already on screen, so nothing above the fold stays hidden.
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
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
    { img: "step-photo", alt: "A restaurant table seen from above, hands reaching toward a phone that reads the paper check.", title: "Photo the bill", desc: "Host photographs the receipt. AI reads every item instantly. No typing." },
    { img: "step-share", alt: "A phone floating against dark space, its screen filled with a glowing QR code.", title: "Share the QR", desc: "A unique QR code appears. Everyone scans it. No app download. No account needed." },
    { img: "step-claim", alt: "Phones arranged in a circle, each screen showing a claimed item marked with a check.", title: "Claim your items", desc: "Each person claims what they ordered. Tax and tip split proportionally." },
    { img: "step-pay", alt: "A phone screen showing a payment confirmed, coins drifting upward from it.", title: "Pay in one tap", desc: "Venmo, Cash App, or Zelle. One tap. Host sees paid/unpaid in real time." },
  ];

  const splitModes = [
    { img: "mode-even", alt: "A receipt divided into equal glowing slices, like a pie chart.", title: "Even Split", desc: "Everyone pays the same. Auto-divides as guests join." },
    { img: "mode-itemized", alt: "A receipt with individual line items lit up separately, each floating above the paper.", title: "Itemized Split", desc: "Claim exactly what you ordered. Tax and tip prorated automatically." },
    { img: "mode-custom", alt: "Adjustable percentage sliders and segments arranged on a grid.", title: "Custom Split", desc: "Percentage, fixed amounts, or shares. You control who pays what." },
  ];

  // Bento tiles — deliberately different weights so the section reads as a
  // composed surface, not a row of identical icon cards.
  const features = [
    { icon: Camera, title: "AI receipt scanning", desc: "Photo the bill. AI reads every line item — name, price, tax — in about a second." },
    { icon: Lock, title: "Secure QR tokens", desc: "HMAC-signed. Refreshes every 25 min." },
    { icon: Users, title: "Guest access", desc: "Scan and join. No download needed." },
    { icon: Zap, title: "Real-time tracking", desc: "See who's paid and who hasn't. Live." },
    { icon: CreditCard, title: "One-tap payment", desc: "Venmo, Cash App, or Zelle. Done." },
    // "Always on record" implied a vault this product does not have. A guest
    // has no account, so their history is the index kept on their own phone —
    // which is now true, where before this line described nothing at all.
    { icon: FileText, title: "Bill history", desc: "Every split you've been in. Kept on your phone." },
  ];

  const stats = [
    { value: "0", label: "Accounts needed to split" },
    { value: "3", label: "Payment apps supported" },
    { value: "25", unit: "min", label: "QR security refresh" },
    { value: "30", unit: "s", label: "To split a bill" },
  ];

  const trustBadges = [
    { icon: Users, text: "Guest access — no signup to join" },
    { icon: Lock, text: "HMAC signed — cryptographic QR tokens" },
    { icon: Shield, text: "Payment ready — Venmo, Cash App, and Zelle" },
    { icon: FileText, text: "Zero data sold — your splits stay private" },
    { icon: Smartphone, text: "Venmo / Cash App / Zelle — US payment stack" },
    { icon: Zap, text: "Built in public — no hidden roadmap" },
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

  /**
   * Two lines, and both are true as of migration 0016.
   *
   * It listed expense categories, recurring bills and bank payouts as well.
   * None of the three exist anywhere in this codebase — not a component, not a
   * column, not a route — and the party-size line was false too: joinSession
   * capped everyone at fifty and had no concept of a plan, so Pro charged for
   * something every free user already had.
   *
   * The cap is real now. Free stops at ten, Pro goes to fifty, and a split
   * attributed to a restaurant is exempt because that restaurant pays $149.
   */
  const proFeatures = [
    "Everything in Free",
    "Your running tab — every bill still settling, across all your meals, in one place",
    /**
     * Fifty, not "unlimited".
     *
     * MAX_PARTY in worker/routes/functions.js is a hard 50 and always has
     * been — joinSession answers `session_full` at fifty-one. Its comment says
     * outright that the copy is the thing that should move, not the number,
     * and the note directly above this list already said "Pro goes to fifty"
     * while the bullet underneath it said unlimited.
     *
     * Fifty is past any real table, so nothing is lost by saying it, and a Pro
     * subscriber who booked a party of sixty on the strength of the word
     * "unlimited" is a refund and a bad review rather than a support ticket.
     */
    "Up to 50 people per split — five times the free limit",
  ];

  const [proBusy, setProBusy] = useState(false);
  const [proError, setProError] = useState(null);

  /**
   * Monthly by default; the yearly toggle appears only when the server says a
   * checkout for it would succeed.
   *
   * getBillingConfig returns a plain boolean — annual exists once its Stripe
   * price is bound. Asking rather than hardcoding means the deploy is safe
   * before the price is created: the toggle is simply absent until it is, then
   * appears on its own, with nothing to change here.
   */
  const [billingInterval, setBillingInterval] = useState("monthly");
  const [annualAvailable, setAnnualAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/fn/getBillingConfig", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json())
      .then((d) => { if (alive) setAnnualAvailable(Boolean(d?.annual_available)); })
      .catch(() => { /* no toggle, monthly only — the safe default */ });
    return () => { alive = false; };
  }, []);

  /**
   * Ask the Worker for a Stripe Checkout URL and go there.
   *
   * The redirect is a full navigation rather than a new tab: Safari blocks a
   * window.open that happens after an await, and this one has to await the
   * round trip to Stripe. Losing the popup would look exactly like the button
   * doing nothing, which is what it used to do for a different reason.
   */
  const startProCheckout = async () => {
    if (proBusy) return;
    setProError(null);
    setProBusy(true);
    try {
      /**
       * A plain fetch, not invoke().
       *
       * invoke() posts to /api/fn/<name>, which is the business-function map in
       * worker/routes/functions.js. This is a top-level route beside
       * /api/create-checkout, so it is called the same way that one is — with
       * the bearer attached by hand, because unlike the fn map nothing does it
       * for us here, and without it the Worker sees an anonymous caller and
       * refuses.
       */
      const token = await accessToken();
      const res = await fetch("/api/create-pro-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        // The interval the toggle is on. The server treats anything but
        // 'annual' as monthly, so a stale value can only ever undersell, never
        // overcharge.
        body: JSON.stringify({ plan: billingInterval }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.url) { window.location.href = data.url; return; }
      if (data.code === "unauthorized") {
        // Pro attaches to a person, so there has to be one. Come back to the
        // pricing block afterwards rather than dumping them on the home page.
        navigate("/login?redirect=" + encodeURIComponent("/#pricing"));
        return;
      }
      if (data.code === "already_pro") {
        // Not an error they did anything wrong — they are already paying. The
        // route refuses because selling a second subscription on the same card
        // is precisely the bug it exists to prevent.
        setProError("You're already on Pro — nothing more to do.");
        return;
      }
      setProError(
        data.code === "not_configured"
          ? "Pro isn't open for sign-ups yet — check back shortly."
          : (data.error || "Could not open checkout. Try again in a moment."),
      );
    } catch {
      setProError("Could not reach checkout. Check your connection and try again.");
    } finally {
      setProBusy(false);
    }
  };

  const faqs = [
    { q: "Do I need to download an app?", a: "No. BillTap works in any mobile browser. Guests join by scanning a QR code — no download, no account required." },
    { q: "Is BillTap really free?", a: "Yes. The free plan covers unlimited splits, up to 10 people per session, all 3 split modes, AI receipt scanning, and settlement via payment links — no credit card required. Pro ($3.99/mo) adds your running tab \u2014 every bill still settling in one place \u2014 and raises the limit to 50 people per split." },
    { q: "How does the QR code work?", a: "The host generates a unique QR code after scanning the receipt. Guests scan it to join the split instantly. Tokens refresh every 25 minutes for security." },
    { q: "What payment apps are supported?", a: "Venmo, Cash App, and Zelle. Guests tap their preferred method and pay in one tap. Hosts see who's paid in real time." },
    { q: "Can I split custom amounts?", a: "Yes. Custom split mode lets you assign percentages, fixed amounts, or shares. Configure it after guests join from the Session Host screen." },
    { q: "Is there a limit on group size?", a: "Free supports up to 10 people per session — enough for most dinners. An 11th person is told the split is full, and you're told on your own screen once the table hits 10. Pro ($3.99/mo) raises it, and keeps every unsettled bill in one running tab." },
    { q: "Is my data secure?", a: "Yes. QR tokens are HMAC-signed and time-limited. We don't sell data. Receipts and split history are private to session participants." },
  ];

  const navLinks = [{ label: "How it works", href: "#how-it-works" }, { label: "Pricing", href: "#pricing" }, { label: "Security", href: "#security" }];

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      {/*
        The highest-authority URL on the domain carried no structured data at
        all — no application, no price, and no FAQ markup despite six real
        questions rendered further down this page.

        The FAQ entities are derived from `faqs` rather than retyped, so the
        markup and the visible page cannot drift apart. Google penalises
        FAQPage markup that does not match on-page content, and a hand-copied
        second list is exactly how that happens six months from now.

        Both tiers are real and both are stated: Free is genuinely $0, and Pro
        is a live Stripe subscription at $3.99/month — priced with
        UnitPriceSpecification for the same reason the restaurant page is, so
        a crawler cannot read a recurring charge as a one-off.

        No aggregateRating, no review. There are no customers yet, so any
        number there would be fabricated — and invented review markup is what
        earns a manual action.
      */}
      <Seo
        path="/"
        title="BillTap — Split the Bill in 30 Seconds, No App"
        description="Scan the receipt, share a QR code, everyone claims their items and pays their exact share. No app, no accounts, no math, no IOUs."
        schema={[
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "BillTap",
            applicationCategory: "FinanceApplication",
            operatingSystem: "Web",
            url: "https://billtap.app",
            description:
              "Photograph a restaurant receipt, share a QR code, and everyone at the table claims what they ordered and pays their exact share. No app download and no account.",
            offers: [
              {
                "@type": "Offer",
                name: "Free",
                price: "0",
                priceCurrency: "USD",
                availability: "https://schema.org/InStock",
                description:
                  "Unlimited bill splits for up to 10 people per split, all three split modes, receipt scanning and QR sharing. No credit card.",
              },
              {
                "@type": "Offer",
                name: "Pro",
                price: "3.99",
                priceCurrency: "USD",
                availability: "https://schema.org/InStock",
                url: "https://billtap.app/#pricing",
                description:
                  "$3.99 per month after a 14-day free trial. Adds a running tab across meals and raises the limit to 50 people per split.",
                priceSpecification: {
                  "@type": "UnitPriceSpecification",
                  price: "3.99",
                  priceCurrency: "USD",
                  unitCode: "MON",
                  unitText: "month",
                  billingDuration: 1,
                  billingIncrement: 1,
                },
                seller: { "@type": "Organization", name: "BillTap", url: "https://billtap.app" },
                areaServed: { "@type": "Country", name: "US" },
              },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqs.map((faq) => ({
              "@type": "Question",
              name: faq.q,
              acceptedAnswer: { "@type": "Answer", text: faq.a },
            })),
          },
        ]}
      />
      <style>{`
        .lp-img { display:block; width:100%; height:100%; object-fit:cover; opacity:0; transition:opacity .5s var(--ease-out); }
        .lp-img.is-loaded { opacity: var(--to, 1); }
        .lp-wash { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; pointer-events:none; user-select:none; }
        .lp-scrim { position:absolute; inset:0; pointer-events:none; }
        .lp-media { position:relative; aspect-ratio:16/10; overflow:hidden; background:linear-gradient(135deg, rgba(0,200,150,0.10) 0%, rgba(7,11,22,0.9) 70%); }
        .lift { transition: transform .3s var(--ease-out), box-shadow .3s var(--ease-out), border-color .3s var(--ease-out); }
        @media (hover:hover){ .lift:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); } }
        @media (prefers-reduced-motion: reduce){ .lp-img{ transition:none; } }
      `}</style>

      {/* ── STICKY NAV ── */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "glass border-b border-border/70" : "border-b border-transparent"}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 md:h-[68px]">
            <div className="flex items-center gap-2.5">
              <Logo size={30} />
              <span className="font-display font-bold text-lg tracking-tight text-foreground">BillTap</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              {navLinks.map(l => (
                <a key={l.label} href={l.href} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">{l.label}</a>
              ))}
            </div>
            <div className="flex items-center gap-2.5">
              {/*
                /restaurants had no link anywhere on this page — the highest-
                authority URL on the domain pointed nowhere at the $149/mo
                product. An owner who hears "BillTap" at a table and types the
                domain landed on the consumer app with no path to the pitch.
              */}
              <Link to="/restaurants" className="press text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hidden sm:block px-2">For Restaurants</Link>
              <Link to="/login" className="press text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hidden sm:block px-2">Sign in</Link>
              <button onClick={handleSplitNow} className="press bg-primary text-primary-foreground text-sm font-semibold rounded-lg px-4 py-2 shadow-glow transition hover:brightness-110">
                Split a bill
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative min-h-[100dvh] flex items-center pt-24 pb-16 overflow-hidden bg-aurora">
        {/* Aurora + ledger grid only. The generated hero photo carried a baked-in
            watermark and product wordmark, and on a premium surface the receipt
            to the right is the real hero object — a stock scene only competes
            with it. */}
        <div aria-hidden="true" className="absolute inset-0 bg-grid opacity-[0.5] [mask-image:radial-gradient(75%_65%_at_35%_25%,#000,transparent)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-14 lg:gap-10 items-center">
            {/* Left: copy */}
            <div>
              <h1 className="animate-rise font-display font-bold tracking-[-0.04em] text-[clamp(2.75rem,8vw,4.75rem)] leading-[0.98]">
                Scan. Split.<br /><span className="text-primary">Settled.</span>
              </h1>
              <p className="animate-rise text-lg md:text-xl leading-relaxed text-muted-foreground max-w-xl mt-6" style={{ animationDelay: ".08s" }}>
                Photograph the bill. Everyone scans the QR, claims their items, and pays their exact share in one tap. No math. No awkwardness. No chasing anyone.
              </p>
              <div className="animate-rise flex flex-col sm:flex-row gap-3 mt-8" style={{ animationDelay: ".16s" }}>
                <button data-no-constraint onClick={handleSplitNow} className="press sheen inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold text-base rounded-xl px-7 h-14 shadow-glow transition hover:brightness-110">
                  Split a bill now <ArrowRight className="w-4 h-4" />
                </button>
                <a data-no-constraint href="#how-it-works" className="press inline-flex items-center justify-center gap-2 border border-border text-foreground font-semibold text-base rounded-xl px-7 h-14 transition hover:bg-accent hover:border-primary/40">
                  See how it works
                </a>
              </div>
              {/* proof row — real, not an eyebrow */}
              <div className="animate-rise flex flex-wrap items-center gap-x-6 gap-y-2 mt-8 text-sm text-muted-foreground" style={{ animationDelay: ".24s" }}>
                {["No app to download", "No account to join", "Free to start"].map(t => (
                  <span key={t} className="inline-flex items-center gap-2">
                    <Check className="w-4 h-4 text-primary" /> {t}
                  </span>
                ))}
              </div>
              {/* The one line on this page aimed at an owner instead of a
                  diner — see the nav link above for the fuller reasoning. */}
              <p className="animate-rise text-sm mt-6" style={{ animationDelay: ".28s" }}>
                <Link to="/restaurants" className="text-primary font-medium hover:underline">Own a restaurant? Turn every split into a 5-star review →</Link>
              </p>
            </div>
            {/* Right: the split, already done */}
            <div className="flex justify-center lg:justify-end animate-rise" style={{ animationDelay: ".2s" }}>
              <SplitReceipt />
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="relative py-20 md:py-28 border-t border-border/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-14">
            <h2 className="font-display text-3xl md:text-5xl font-bold tracking-tight">Four steps, thirty seconds</h2>
            <p className="text-lg text-muted-foreground mt-4">From the check landing on the table to everyone squared up. No math required.</p>
          </div>

          <div className="grid lg:grid-cols-[300px_1fr] gap-12 lg:gap-16 items-start">
            {/* demo video — no glow here; the hero receipt is the single aurora
                anchor, and the framed clip carries its own light. */}
            <div className="relative mx-auto lg:mx-0 w-[min(72vw,280px)] lg:sticky lg:top-24">
              <div className="glass-strong rounded-[2rem] p-2.5 shadow-float">
                <DemoVideo name="product-demo" className="rounded-[1.6rem]" />
              </div>
            </div>

            {/* steps as a numbered ledger — the sequence carries meaning */}
            <ol className="relative reveal" data-reveal>
              <div aria-hidden="true" className="absolute left-[19px] top-3 bottom-3 w-px bg-border/70" />
              {steps.map((step, idx) => (
                <li key={idx} className="relative flex gap-5 pb-9 last:pb-0">
                  <span className="relative z-10 grid place-items-center w-10 h-10 shrink-0 rounded-full bg-card ring-hairline mono text-sm font-semibold text-primary">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <div className="pt-1.5 min-w-0">
                    <h3 className="font-display text-xl font-semibold text-foreground">{step.title}</h3>
                    <p className="text-muted-foreground mt-1.5 leading-relaxed">{step.desc}</p>
                    <div className="lp-media mt-4 rounded-2xl ring-hairline max-w-md">
                      <Img name={step.img} alt={step.alt} />
                      <div className="lp-scrim" style={{ background: "linear-gradient(180deg, transparent 55%, rgba(7,11,22,0.75) 100%)" }} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── SPLIT MODES ── */}
      <section className="relative py-20 md:py-28 border-t border-border/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-14">
            <h2 className="font-display text-3xl md:text-5xl font-bold tracking-tight">Three ways to split</h2>
            <p className="text-lg text-muted-foreground mt-4">Pick the one that fits the table. Switch any time before anyone pays.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 reveal" data-reveal>
            {splitModes.map((mode, idx) => (
              <div key={idx} className="lift group rounded-2xl bg-card border border-border/70 overflow-hidden">
                <div className="lp-media" style={{ aspectRatio: "3 / 2" }}>
                  <Img name={mode.img} alt={mode.alt} />
                  <div className="lp-scrim" style={{ background: "linear-gradient(180deg, transparent 50%, rgba(12,18,32,0.9) 100%)" }} />
                </div>
                <div className="p-6">
                  <h3 className="font-display text-xl font-semibold text-foreground group-hover:text-primary transition-colors">{mode.title}</h3>
                  <p className="text-muted-foreground mt-2 leading-relaxed">{mode.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES (bento) ── */}
      <section id="features" className="relative py-20 md:py-28 border-t border-border/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-14">
            <h2 className="font-display text-3xl md:text-5xl font-bold tracking-tight">Built for real dinners</h2>
            <p className="text-lg text-muted-foreground mt-4">Everything you need to split a bill without the drama — and nothing you don't.</p>
          </div>
          {/* Lead tile is a 2×2 block on desktop so the remaining five singles
              close a clean 3×3 (no orphaned trailing tile); one column on mobile. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 auto-rows-[minmax(0,1fr)] reveal" data-reveal>
            <div className="lg:col-span-2 lg:row-span-2 rounded-2xl bg-card border border-border/70 p-7 flex flex-col justify-between overflow-hidden relative border-glow">
              <div>
                <div className="w-11 h-11 rounded-xl bg-primary/10 grid place-items-center mb-4">
                  <Camera className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-display text-xl font-semibold">{features[0].title}</h3>
                <p className="text-muted-foreground mt-2 max-w-md leading-relaxed">{features[0].desc}</p>
              </div>
              <div className="mt-6 flex items-start gap-3 text-sm">
                <ScanLine className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span className="mono text-xs text-muted-foreground leading-relaxed">2× Cacio e pepe · Negroni · Burrata · Water<span className="whitespace-nowrap"> — <span className="text-primary font-medium">read in 1.1s</span></span></span>
              </div>
            </div>
            {features.slice(1).map((f, i) => (
              <div key={i} className="rounded-2xl bg-card border border-border/70 p-6 lift">
                <div className="w-10 h-10 rounded-xl bg-primary/10 grid place-items-center mb-4">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-display text-base font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="relative py-20 md:py-28 border-t border-border/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-14">
            <h2 className="font-display text-3xl md:text-5xl font-bold tracking-tight">Start free. Upgrade when you need more.</h2>
            <p className="text-lg text-muted-foreground mt-4">Free gets most people everything they need. Pro unlocks when your use case gets serious.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-5 max-w-3xl reveal" data-reveal>
            {/* Free */}
            <div className="rounded-2xl bg-card border border-border/70 p-8 flex flex-col">
              <p className="mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Free</p>
              <p className="text-sm text-muted-foreground mt-2">For most dinners and group meals.</p>
              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="mono text-5xl font-semibold tabular-nums">$0</span>
                <span className="text-muted-foreground">/ forever</span>
              </div>
              <ul className="space-y-3 mt-7 mb-8 flex-1">
                {freeFeatures.map(f => (
                  <li key={f} className="flex items-start gap-3">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary" />
                    <span className="text-sm text-foreground/90">{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/register" className="press block w-full py-3.5 rounded-xl font-semibold text-sm text-center border border-border text-foreground transition hover:bg-accent hover:border-primary/40">
                Start free
              </Link>
              <p className="text-center text-xs mt-3 text-muted-foreground">No credit card · Always free</p>
            </div>

            {/* Pro */}
            <div className="relative rounded-2xl bg-card p-8 flex flex-col border-glow shadow-float">
              <div className="absolute -top-3 left-8"><span className="bg-primary text-primary-foreground text-xs font-bold rounded-full px-3 py-1 shadow-glow">Most popular</span></div>
              <p className="mono text-xs uppercase tracking-[0.2em] text-primary">Pro</p>
              <p className="text-sm text-muted-foreground mt-2">Never lose track of who's paid you back.</p>

              {/* The interval toggle, present only when a yearly checkout would
                  actually succeed — see getBillingConfig. Monthly-only shows no
                  toggle at all, so the card is unchanged until annual exists. */}
              {annualAvailable && (
                <div className="mt-5 inline-flex rounded-xl p-1 text-sm font-semibold" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }} role="group" aria-label="Billing interval">
                  <button
                    type="button"
                    onClick={() => setBillingInterval("monthly")}
                    aria-pressed={billingInterval === "monthly"}
                    className={`press px-3 py-1.5 rounded-lg transition ${billingInterval === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setBillingInterval("annual")}
                    aria-pressed={billingInterval === "annual"}
                    className={`press px-3 py-1.5 rounded-lg transition ${billingInterval === "annual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Yearly
                    <span className="ml-1.5 text-[10px] font-bold" style={{ color: billingInterval === "annual" ? "inherit" : "#00c896" }}>SAVE 39%</span>
                  </button>
                </div>
              )}

              <div className="mt-5 flex items-baseline gap-1.5">
                {billingInterval === "annual" ? (
                  <>
                    <span className="mono text-5xl font-semibold tabular-nums">$29</span>
                    <span className="text-muted-foreground">/ year</span>
                  </>
                ) : (
                  <>
                    <span className="mono text-5xl font-semibold tabular-nums">$3.99</span>
                    <span className="text-muted-foreground">/ month</span>
                  </>
                )}
              </div>
              {billingInterval === "annual" && (
                // $29 / 12 = $2.42, and the honest anchor is the real monthly
                // price, not a round number invented to flatter the saving.
                <p className="text-xs text-primary mt-1.5">Just $2.42/mo, billed yearly · vs $3.99/mo</p>
              )}
              <ul className="space-y-3 mt-7 mb-8 flex-1">
                {proFeatures.map(f => (
                  <li key={f} className="flex items-start gap-3">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary" />
                    <span className="text-sm text-foreground/90">{f}</span>
                  </li>
                ))}
              </ul>
              {/*
                A real checkout, not a signup link.

                This pointed at /register, so the button that said "Start Pro
                free trial" started nothing: it made an account on the free
                plan and left the person who had just decided to pay with
                nowhere to do it. Now it asks the Worker for a Stripe Checkout
                URL and sends them there.

                Signing in first is a requirement rather than a nicety. Pro
                attaches to a person, and create-pro-checkout takes the user id
                from a verified session and never from the request -- otherwise
                anyone could start a checkout in anyone else's name. An
                unauthenticated caller is bounced to /login and comes back.
              */}
              <button
                type="button"
                onClick={startProCheckout}
                disabled={proBusy}
                className="press inline-flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-semibold text-sm bg-primary text-primary-foreground shadow-glow transition hover:brightness-110 disabled:opacity-60"
              >
                {proBusy ? "Opening checkout…" : "Start Pro free trial"} <ArrowRight className="w-4 h-4" />
              </button>
              {proError && (
                <p className="text-center text-xs mt-3" style={{ color: "#e5484d" }}>{proError}</p>
              )}
              <p className="text-center text-xs mt-3 text-muted-foreground">14-day free trial · Then {billingInterval === "annual" ? "$29/yr" : "$3.99/mo"}</p>
              {/*
                Naming the processor, because it is the one trust mark this
                page has actually earned.

                An audit of this site listed "no visible payment processor"
                alongside the missing logo wall and the missing SOC 2 badge.
                Two of those cannot be fixed without inventing customers. This
                one is simply true and was going unsaid: checkout is Stripe,
                and no card number has ever reached this app.
              */}
              <p className="text-center text-xs mt-1.5 text-muted-foreground">
                Payments by Stripe · Card details never touch BillTap
              </p>
            </div>
          </div>

          {/* Monetization trigger note */}
          <div className="max-w-3xl mt-5 p-5 rounded-xl bg-surface/60 border border-border/70 flex gap-4 items-start">
            <Zap className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">When does Pro kick in?</span> When your table reaches 10 people, BillTap tells you on the split screen that it's full — right at the moment it's actually useful. No nag screens before then.
            </p>
          </div>

          {/* Waitlist card */}
          <div className="relative max-w-3xl mt-6 p-6 rounded-2xl bg-card border border-border/70 overflow-hidden">
            <Wash name="celebrate" opacity={0.14} position="top" />
            <div className="lp-scrim" style={{ background: "linear-gradient(180deg, rgba(12,18,32,0.5) 0%, rgba(12,18,32,0.92) 60%, #0c1220 100%)" }} />
            <div className="relative">
              {/*
                This card used to read "Pro features coming soon" and offer a
                waitlist — directly underneath a working Stripe checkout button
                for Pro.

                That contradiction was the worst credibility problem on the
                page. An outside audit of this site concluded the product was
                unfinished and the Pro tier unreleased, on the strength of this
                card alone, while the button eighteen lines above it was taking
                real money.

                So it says what actually shipped instead. Everything listed
                below is live in production today and can be checked by anyone
                reading this — which is the version of "built in public" that
                is worth anything.
              */}
              <h3 className="font-display text-xl font-semibold">Shipped this week</h3>
              <p className="text-sm text-muted-foreground mt-2 mb-4 max-w-lg">
                Built in public means telling you what changed, not just that something did.
              </p>
              <ul className="space-y-2.5 mb-6 max-w-lg">
                {[
                  "Share a plate. Two people tap the same nachos and it splits between them — it used to go entirely to whoever was quickest.",
                  "See what fairness saved you. Your share now shows what an even split would have cost instead.",
                  "Rate a restaurant without splitting anything. One tap from the table tent, no receipt required.",
                  "Hosts settle everyone who paid in one tap, instead of one tap each.",
                ].map(item => (
                  <li key={item} className="flex items-start gap-3">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary" aria-hidden="true" />
                    <span className="text-sm text-foreground/90">{item}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground mb-4 max-w-lg">
                Want to hear when the next one lands? Leave an email. That is the only thing it is used for.
              </p>
              {waitlistStatus === "done" ? (
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <Check className="w-4 h-4" /> You&apos;re on the list. You&apos;ll hear from us when something ships — nothing else.
                </div>
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row gap-2 max-w-lg">
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
                      className="flex-1 h-11 rounded-xl border border-input bg-surface/60 px-4 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
                    />
                    <button
                      onClick={handleWaitlist}
                      disabled={waitlistStatus === "loading"}
                      aria-busy={waitlistStatus === "loading"}
                      aria-label="Get an email when something new ships"
                      className="press px-5 h-11 rounded-xl font-semibold text-sm bg-primary text-primary-foreground shadow-glow transition hover:brightness-110 whitespace-nowrap disabled:opacity-60"
                    >
                      {waitlistStatus === "loading" ? "Adding…" : "Keep me posted"}
                    </button>
                  </div>
                  {waitlistStatus === "error" && (
                    <p role="alert" className="text-xs mt-2 text-destructive">
                      That didn&apos;t go through. Please try again, or email hello@billtap.app and we&apos;ll add you by hand.
                    </p>
                  )}
                  <p className="text-xs mt-3 text-muted-foreground">No spam, no drip sequence. An email when something ships. Unsubscribe anytime.</p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── SECURITY / STATS ── */}
      <section id="security" className="relative py-20 md:py-28 border-t border-border/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* stat ledger — one row, hairline-divided, mono numerals */}
          <div className="rounded-2xl bg-card border border-border/70 grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border/70 overflow-hidden mb-16 reveal" data-reveal>
            {stats.map(stat => (
              <div key={stat.label} className="p-6 md:p-8">
                <div className="mono text-4xl md:text-5xl font-semibold tabular-nums text-foreground leading-none">
                  {stat.value}{stat.unit && <span className="text-2xl text-muted-foreground">{stat.unit}</span>}
                </div>
                <div className="text-sm text-muted-foreground mt-3">{stat.label}</div>
              </div>
            ))}
          </div>

          <div className="max-w-2xl mb-10">
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">Boring where it counts</h2>
            <p className="text-lg text-muted-foreground mt-4">The fun part is splitting the bill. The serious part is everything underneath it.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-10 gap-y-5">
            {trustBadges.map(badge => (
              <div key={badge.text} className="flex items-center gap-4 py-3 border-b border-border/50">
                <div className="w-9 h-9 rounded-lg bg-primary/10 grid place-items-center flex-shrink-0">
                  <badge.icon className="w-4 h-4 text-primary" />
                </div>
                <p className="text-sm text-foreground/90">{badge.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="relative py-24 md:py-32 border-t border-border/60 overflow-hidden bg-aurora">
        <div aria-hidden="true" className="absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(60%_60%_at_50%_50%,#000,transparent)]" />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-display text-4xl md:text-6xl font-bold tracking-[-0.03em] leading-[1.02]">
            The bill just came.<br /><span className="text-primary">Don't do the math.</span>
          </h2>
          <p className="text-lg md:text-xl text-muted-foreground mt-6 max-w-xl mx-auto">
            BillTap handles it. Scan, claim, pay. Built for real dinners with real friends. Free to start. No tricks.
          </p>
          <button data-no-constraint onClick={handleSplitNow} className="press sheen inline-flex items-center justify-center gap-2 mt-9 bg-primary text-primary-foreground font-semibold text-lg rounded-xl px-9 py-4 shadow-glow transition hover:brightness-110">
            Split your first bill free <ArrowRight className="w-5 h-5" />
          </button>
          <p className="mt-5 text-sm text-muted-foreground">No credit card. No account needed. US only.</p>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="relative py-20 md:py-28 border-t border-border/60">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight mb-10">Frequently asked questions</h2>
          <div className="divide-y divide-border/60 reveal" data-reveal>
            {faqs.map((faq, i) => (
              <details key={i} className="group py-5" {...(i === 0 ? { open: true } : {})}>
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none">
                  <h3 className="font-display text-base md:text-lg font-semibold text-foreground">{faq.q}</h3>
                  <span className="shrink-0 w-6 h-6 grid place-items-center rounded-full border border-border text-muted-foreground transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <p className="text-sm md:text-[15px] leading-relaxed text-muted-foreground mt-3 pr-10">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="py-14 md:py-16 border-t border-border/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-10">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2.5 mb-4">
                <Logo size={30} />
                <span className="font-display font-bold text-xl tracking-tight text-foreground">BillTap</span>
              </div>
              <p className="text-sm max-w-xs leading-relaxed text-muted-foreground">
                The fastest way to split a bill. No math. No drama. No chasing anyone.
              </p>
            </div>
            <div>
              <h4 className="mono font-semibold text-xs mb-4 uppercase tracking-[0.18em] text-muted-foreground/80">Product</h4>
              <ul className="space-y-3">
                {[...navLinks, { label: "FAQ", href: "#faq" }].map(l => (
                  <li key={l.label}><a href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-primary">{l.label}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="mono font-semibold text-xs mb-4 uppercase tracking-[0.18em] text-muted-foreground/80">Company</h4>
              <ul className="space-y-3">
                <li><Link to="/about" className="text-sm text-muted-foreground transition-colors hover:text-primary">About</Link></li>
                <li><Link to="/blog" className="text-sm text-muted-foreground transition-colors hover:text-primary">Blog</Link></li>
                <li><a href="https://billtap.app" className="text-sm text-muted-foreground transition-colors hover:text-primary">billtap.app</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">© 2026 BillTap. Built in public by Kai Cogmon.</p>
            <div className="flex items-center gap-6">
              <Link to="/terms" className="text-sm text-muted-foreground transition-colors hover:text-primary">Terms</Link>
              <Link to="/privacy" className="text-sm text-muted-foreground transition-colors hover:text-primary">Privacy</Link>
              <Link to="/security" className="text-sm text-muted-foreground transition-colors hover:text-primary">Security</Link>
              <Link to="/promises" className="text-sm text-muted-foreground transition-colors hover:text-primary">Promises</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

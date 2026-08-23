import { useState, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Loader2 } from "lucide-react";
import { invoke } from "@/api/functions";
import Seo from "@/components/Seo";

const GOLD = "#f0b429";

/**
 * /new — a live demo page in under ten seconds, typed at a table.
 *
 * ── What this screen is for ─────────────────────────────────────────────────
 *
 * The demo that closes is handing the owner your phone, letting *him* tap two
 * stars on a page carrying *his* restaurant's name, and letting the low-rating
 * alert arrive while he is holding it. Before this, that meant writing a row
 * into the SQL editor the night before — which caps a day at the prospects
 * somebody planned for, and dies fourteen days later without saying so.
 *
 * ── Why it looks like this ──────────────────────────────────────────────────
 *
 * One field, one button, and a QR code big enough to read across a table. It is
 * used one-handed, standing up, in a restaurant, at speed, in front of someone
 * who is deciding whether to keep listening. Every second of styling ambition
 * is a second of that person's attention.
 *
 * The QR is the point of the screen, not a nicety: the prospect scans it off
 * the operator's phone with his own, which is what makes the next thirty
 * seconds his rather than a demonstration he is watching.
 *
 * ── Not linked from anywhere ────────────────────────────────────────────────
 *
 * On purpose, and it is not the security control — createDemoRestaurant checks
 * the allowlist and answers 403 regardless of how anyone arrives. It is that
 * this path has no business appearing in a nav, a sitemap or a crawl. He types
 * the URL. Seo carries noindex for the same reason.
 */
export default function NewDemo() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);
  const [demos, setDemos] = useState([]);
  const [extending, setExtending] = useState(null);
  // Re-rendered once a minute so the countdowns are not frozen at whatever they
  // said when the screen opened — this page stays up between stops.
  const [, setTick] = useState(0);
  const field = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  /** His demos from earlier stops today, so an old one can be re-opened. */
  async function refresh() {
    try {
      const res = await invoke("listMyDemoRestaurants");
      setDemos(res?.data?.demos || []);
    } catch {
      // Not surfaced. The list is a convenience; failing to load it must not
      // put an error on a screen whose one job still works.
    }
  }

  useEffect(() => { refresh(); }, []);

  /** Pushes one demo's clock back out, in place — the slug never changes. */
  async function extend(slug) {
    if (extending) return;
    setExtending(slug);
    try {
      const res = await invoke("extendDemoRestaurant", { slug });
      const updated = res?.data || null;
      if (updated) {
        setCreated((c) => (c?.slug === slug ? { ...c, ...updated } : c));
      }
      await refresh();
    } catch {
      // Not surfaced. Worst case the button is tapped again — extending twice
      // just resets the same clock to the same week out.
    } finally {
      setExtending(null);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await invoke("createDemoRestaurant", { name });
      setCreated(res?.data || null);
      setName("");
      refresh();
    } catch (e) {
      setError(e?.message || "Couldn't create that demo.");
    } finally {
      setBusy(false);
      field.current?.focus();
    }
  }

  return (
    <div className="min-h-screen px-5 py-7" style={{ background: "#0a0e1a", color: "#fff" }}>
      <Seo title="New demo — BillTap" description="Operator tool." path="/new" noindex />

      <div className="w-full max-w-md mx-auto">
        <form onSubmit={submit}>
          <label htmlFor="demo-name" className="block text-xs uppercase tracking-[0.2em]" style={{ color: GOLD }}>
            Restaurant name
          </label>
          <input
            id="demo-name"
            ref={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            /* Autofocused and word-capitalised because the next thing that
               happens is a thumb typing a proper noun. */
            autoFocus
            autoCapitalize="words"
            autoComplete="off"
            autoCorrect="off"
            maxLength={120}
            className="mt-2 w-full px-4 py-4 rounded-2xl text-lg font-semibold"
            style={{ background: "rgba(255,255,255,.07)", color: "#fff", border: "1px solid rgba(255,255,255,.14)" }}
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="mt-3 w-full py-4 rounded-2xl font-black flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: GOLD, color: "#1a1200" }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Create demo page
          </button>
        </form>

        {error ? (
          <p className="mt-4 text-sm" style={{ color: "#e5484d" }}>{error}</p>
        ) : null}

        {created ? (
          <DemoCard demo={created} highlight onExtend={extend} extending={extending === created.slug} />
        ) : null}

        {demos.length ? (
          <div className="mt-9">
            <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "rgba(255,255,255,.4)" }}>
              Still live
            </p>
            {demos
              .filter((d) => d.slug !== created?.slug)
              .map((d) => (
                <DemoCard key={d.slug} demo={d} onExtend={extend} extending={extending === d.slug} />
              ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * How long is left, in the units somebody standing at a table thinks in.
 *
 * Minutes under an hour, hours under a day, days once a demo lives a week —
 * "163h" is not a unit anyone standing at a table thinks in, and "6d 4h left"
 * is a lot easier to trust than one long number.
 */
function timeLeft(expiresAt) {
  if (!expiresAt) return "no expiry";
  const ms = Number(expiresAt) - Date.now();
  if (ms <= 0) return "expired";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m left`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h left` : `${days}d left`;
}

/**
 * Under three hours left — the point where the countdown turns gold.
 *
 * This was 24 hours, which was defensible only while demos lived a week. With
 * the default back at a day it made every demo urgent from the moment it was
 * created: gold on creation, gold until it died, which is the same as having
 * no warning at all. A signal that is always on is not a signal.
 *
 * Three hours is a fixed threshold rather than a fraction of the term because
 * the browser is not told the term — DEMO_TTL_HOURS lives on the server and
 * can change without a deploy. It reads correctly at either end of that range:
 * the last eighth of a one-day demo, and genuinely the last moments of a
 * one-week one. What it means is "extend this now if the prospect still cares",
 * and that is true whenever it fires.
 */
const EXPIRING_SOON_MS = 3 * 3600000;

function expiringSoon(expiresAt) {
  if (!expiresAt) return false;
  const ms = Number(expiresAt) - Date.now();
  return ms > 0 && ms < EXPIRING_SOON_MS;
}

/** @param {{ demo: any, highlight?: boolean, onExtend?: (slug: string) => void, extending?: boolean }} props */
function DemoCard({ demo, highlight = false, onExtend, extending = false }) {
  const soon = expiringSoon(demo.expires_at);
  return (
    <div
      className="mt-5 p-5 rounded-3xl text-center"
      style={{
        background: highlight ? "rgba(240,180,41,.09)" : "rgba(255,255,255,.05)",
        border: `1px solid ${highlight ? "rgba(240,180,41,.35)" : "rgba(255,255,255,.09)"}`,
      }}
    >
      <h2 className="text-2xl font-black">{demo.name}</h2>

      {/* White plate behind the code, not the page background. A QR rendered
          dark-on-dark scans from nothing, and this one is scanned by a stranger's
          phone across a table in restaurant lighting. */}
      <div className="mt-4 inline-block p-3 rounded-2xl" style={{ background: "#fff" }}>
        <QRCodeSVG value={demo.url} size={highlight ? 232 : 148} level="M" fgColor="#0a0e1a" />
      </div>

      {/* The URL as large tappable text, for when the QR does not scan — which
          is why the slug alphabet has no vowels and no `l`: this gets read
          aloud and typed by hand. */}
      <a
        href={demo.url}
        className="mt-4 block text-lg font-bold break-all underline"
        style={{ color: GOLD }}
      >
        {demo.url.replace(/^https?:\/\//, "")}
      </a>

      <p className="mt-2 text-xs" style={{ color: soon ? GOLD : "rgba(255,255,255,.45)" }}>
        {timeLeft(demo.expires_at)}
      </p>

      {onExtend ? (
        <button
          type="button"
          onClick={() => onExtend(demo.slug)}
          disabled={extending}
          className="mt-3 text-xs font-bold underline disabled:opacity-50"
          style={{ color: GOLD }}
        >
          {/*
            "Extend", not "Extend another week".

            How long an extension buys is DEMO_TTL_HOURS on the server, which
            the browser is never told and which can be changed without a
            deploy. A button naming a specific term was a promise this screen
            has no way to keep — it said "another week" while the default was a
            day, which is the kind of small lie an operator only discovers in
            front of a prospect. The countdown directly above updates the
            moment this returns, so the honest answer is on screen anyway.
          */}
          {extending ? "Extending…" : "Extend"}
        </button>
      ) : null}
    </div>
  );
}

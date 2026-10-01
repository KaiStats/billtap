import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import Seo from "@/components/Seo";

/**
 * Lead magnet: "How many guests is your restaurant losing without knowing it?"
 *
 * Seven yes/no questions about the places an unhappy guest slips out unheard.
 * The score is the owner's own answers counted, nothing more — no industry
 * statistic, no BillTap measurement (see src/csp.test.mjs).
 */
const GOLD = "#f0b429";
const INK = "#0b0b0d";
const SIGNUP = "/restaurants?utm_source=audit&utm_campaign=guest_recovery_audit";

const QUESTIONS = [
  ["Rush hour blind spot", "During your busiest service, does someone actually check on every table after the food lands?"],
  ["The quiet complaint", "If a guest is unhappy but too polite to say so, would anyone on your team know before they left?"],
  ["The manager loop", "When a server hears a complaint, does it reliably reach a manager while the guest is still there?"],
  ["The counter gap", "For takeout, pickup and counter orders, do you have any way to hear how the food was?"],
  ["The review surprise", "Did you hear about your last bad review before it was posted?"],
  ["The repeat problem", "Do you know which complaint comes up most — and on which shift?"],
  ["The lost regular", "If a regular stopped coming after one bad night, would you know why?"],
];

export default function GuestRecoveryAudit() {
  const [answers, setAnswers] = useState({});
  const done = Object.keys(answers).length === QUESTIONS.length;
  const leaks = Object.values(answers).filter((v) => v === "no").length;
  const set = (i, v) => setAnswers((a) => ({ ...a, [i]: v }));

  return (
    <main className="min-h-screen" style={{ background: INK, color: "#f5f5f4" }}>
      <Seo
        path="/guest-recovery-audit"
        title="The 5-Minute Guest Recovery Audit for Restaurant Owners & GMs | BillTap"
        description="How many guests is your restaurant losing without knowing it? Seven questions that find where unhappy guests slip out unheard — and never come back."
      />
      <div className="max-w-3xl mx-auto px-5 sm:px-8 pt-20 pb-20">
        <Link to="/restaurants" className="text-sm hover:underline" style={{ color: GOLD }}>BillTap for restaurants</Link>
        <p className="mt-10 text-xs uppercase tracking-[.14em] font-semibold" style={{ color: "#e5484d" }}>The 5-minute Guest Recovery Audit</p>
        <h1 className="mt-3 font-display leading-[1.04]" style={{ fontSize: "clamp(2.2rem, 5.6vw, 3.8rem)" }}>
          How many guests is your restaurant losing without knowing it?
        </h1>
        <p className="mt-6 text-lg leading-relaxed font-light" style={{ color: "rgba(245,245,244,.72)" }}>
          Your worst customer may never leave a bad review. They just never come back.
          Answer seven honest questions to find where unhappy guests are slipping out unheard.
        </p>

        <ol className="mt-12 space-y-4">
          {QUESTIONS.map(([k, q], i) => (
            <li key={k} className="p-5 sm:p-6 rounded-2xl" style={{ background: "rgba(255,255,255,.03)", border: `1px solid ${answers[i] === "no" ? "rgba(229,72,77,.45)" : "rgba(255,255,255,.08)"}` }}>
              <p className="text-xs font-bold uppercase tracking-[.12em]" style={{ color: GOLD }}>{i + 1}. {k}</p>
              <p className="mt-2 text-base leading-relaxed">{q}</p>
              <div className="mt-4 flex gap-2" role="group" aria-label={k}>
                {[["yes", "Yes"], ["no", "No / not sure"]].map(([v, label]) => (
                  <button key={v} onClick={() => set(i, v)} aria-pressed={answers[i] === v}
                    className="px-4 py-2 rounded-full text-sm font-semibold"
                    style={answers[i] === v
                      ? { background: v === "no" ? "#e5484d" : "#30a46c", color: "#fff" }
                      : { border: "1px solid rgba(245,245,244,.25)", color: "#f5f5f4" }}>
                    {label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-10 p-7 rounded-2xl text-center" aria-live="polite"
          style={{ background: "rgba(240,180,41,.06)", border: "1px solid rgba(240,180,41,.3)" }}>
          {done ? (
            <>
              <p className="font-display text-5xl" style={{ color: leaks ? "#e5484d" : "#30a46c" }}>{leaks} of 7</p>
              <p className="mt-3 text-lg">
                {leaks === 0
                  ? "You're catching unhappy guests better than most rooms. BillTap makes it automatic when you're not on the floor."
                  : `${leaks} place${leaks > 1 ? "s" : ""} where an unhappy guest can leave without anyone knowing. Each one is a review you'll read too late, or a regular who quietly stops coming.`}
              </p>
              <p className="mt-4 text-sm font-light" style={{ color: "rgba(245,245,244,.62)" }}>
                BillTap closes these gaps: every guest is asked as they finish, and a low rating
                alerts your manager with the table and what went wrong — while the guest is still there.
              </p>
              <Link to={SIGNUP} className="mt-6 inline-flex items-center gap-2 font-semibold px-7 py-4 rounded-full" style={{ background: GOLD, color: INK }}>
                Close the leak — start a 14-day free trial <ArrowRight className="w-4 h-4" />
              </Link>
              <p className="mt-3 text-xs" style={{ color: "rgba(245,245,244,.45)" }}>No card. No POS change. $149/month after.</p>
            </>
          ) : (
            <p className="text-sm" style={{ color: "rgba(245,245,244,.62)" }}>
              Answer all seven to see your result — {Object.keys(answers).length} of 7 done.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

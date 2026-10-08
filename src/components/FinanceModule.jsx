import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, Upload, FileText, Sparkles, AlertTriangle, Check } from "lucide-react";
import { invoke } from "@/api/functions";
import {
  UPLOAD_KINDS, MONEY_FIELDS, UPLOAD_MEDIA_TYPES, MAX_UPLOAD_BYTES,
  kpis, guestMonth, normalizeMonth,
} from "../../shared/finance.js";

/**
 * Financial Intelligence, inside the restaurant dashboard.
 *
 * Two views share one load: "overview" (money and guests side by side, plus
 * the combined insights) and "finances" (upload → review → confirm, and the
 * month-by-month table). Every number shown is computed by shared/finance.js
 * from months the owner confirmed — Claude's draft is only ever a starting
 * point on the review form.
 */

const card = { background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" };
const muted = { color: "rgba(255,255,255,.5)" };
const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const usd = (v) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);
const monthLabel = (m) =>
  m ? new Date(`${m}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "";

const errorText = (err) =>
  err?.data?.error || err?.message || "Something went wrong";

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("The file could not be read"));
    reader.readAsDataURL(file);
  });
}

function Tile({ label, value, hint }) {
  return (
    <div className="p-4 rounded-2xl" style={card}>
      <div className="text-2xl font-black">{value}</div>
      <div className="mt-1 text-sm font-semibold">{label}</div>
      {hint && <div className="mt-0.5 text-xs" style={muted}>{hint}</div>}
    </div>
  );
}

function Insights({ data, onGenerate, busy, error, canGenerate }) {
  return (
    <section className="mt-8 p-5 rounded-2xl" style={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: "#f0b429" }} aria-hidden="true" />
          Combined insights{data?.month ? ` — ${monthLabel(data.month)}` : ""}
        </h2>
        <button type="button" onClick={onGenerate} disabled={busy || !canGenerate}
          className="text-sm font-semibold px-4 py-2 rounded-full disabled:opacity-50"
          style={{ background: "#f0b429", color: "#0b0b0d" }}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : data ? "Refresh" : "Generate"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm" style={{ color: "#e5484d" }}>{error}</p>}
      {!data && !error && (
        <p className="mt-3 text-sm" style={muted}>
          {canGenerate
            ? "Compares your latest confirmed month with your guest ratings for the same month."
            : "Confirm at least one month of figures to get insights."}
        </p>
      )}
      {data?.insights?.length > 0 && (
        <ul className="mt-4 space-y-4">
          {data.insights.map((i) => (
            <li key={i.title}>
              <p className="font-semibold">{i.title}</p>
              <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,.75)" }}>{i.body}</p>
              <p className="mt-1 text-xs" style={muted}>
                Based on: {i.fact_keys.map((k) => data.facts.find((f) => f.key === k)).filter(Boolean)
                  .map((f) => `${f.label} ${f.display}`).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {data && data.insights?.length === 0 && (
        <p className="mt-3 text-sm" style={muted}>Not enough data this month to say anything useful yet.</p>
      )}
      <p className="mt-4 text-xs" style={muted}>
        Written by AI from the numbers listed under each point. Things that happen in the same month are not proof one caused the other.
      </p>
    </section>
  );
}

function ReviewForm({ draft, uploadIds, onSaved, onCancel }) {
  const [values, setValues] = useState(() => ({
    month: draft?.period_month ? draft.period_month.slice(0, 7) : "",
    ...Object.fromEntries(MONEY_FIELDS.map((f) => [f.id, draft?.figures?.[f.id] ?? ""])),
    covers: draft?.covers ?? "",
    notes: "",
  }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError(""); setErrors({});
    try {
      const res = await invoke("saveMonthlySnapshot", { snapshot: values, upload_ids: uploadIds });
      onSaved(res.data.snapshot);
    } catch (err) {
      setErrors(err?.data?.fields || {});
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const field = "mt-1 w-full rounded-lg px-3 py-2 text-sm font-semibold";
  const fieldStyle = { background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.14)", color: "#fff" };
  return (
    <form onSubmit={save} className="mt-4 p-5 rounded-2xl" style={{ ...card, borderColor: "rgba(240,180,41,.35)" }}>
      <h3 className="font-bold">Check these figures, then confirm</h3>
      {draft && (
        <p className="mt-1 text-xs" style={muted}>
          Read by AI ({draft.confidence} confidence). Blank means the document didn&apos;t show it.
          {draft.notes ? ` Notes: ${draft.notes}` : ""}
        </p>
      )}
      <div className="mt-4 grid sm:grid-cols-3 gap-3">
        <label className="text-xs" style={muted}>Month
          <input type="month" required value={values.month} onChange={set("month")} className={field} style={fieldStyle} />
          {errors.month && <span style={{ color: "#e5484d" }}>{errors.month}</span>}
        </label>
        {MONEY_FIELDS.map((f) => (
          <label key={f.id} className="text-xs" style={muted}>{f.label} ($)
            <input inputMode="decimal" value={values[f.id]} onChange={set(f.id)} className={field} style={fieldStyle} />
            {errors[f.id] && <span style={{ color: "#e5484d" }}>{errors[f.id]}</span>}
          </label>
        ))}
        <label className="text-xs" style={muted}>Covers (guests served)
          <input inputMode="numeric" value={values.covers} onChange={set("covers")} className={field} style={fieldStyle} />
          {errors.covers && <span style={{ color: "#e5484d" }}>{errors.covers}</span>}
        </label>
      </div>
      {error && <p className="mt-3 text-sm" style={{ color: "#e5484d" }}>{error}</p>}
      <div className="mt-4 flex gap-3">
        <button type="submit" disabled={saving} className="text-sm font-semibold px-4 py-2 rounded-full inline-flex items-center gap-2"
          style={{ background: "#30a46c", color: "#fff" }}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Confirm month
        </button>
        <button type="button" onClick={onCancel} className="text-sm px-4 py-2" style={muted}>Cancel</button>
      </div>
    </form>
  );
}

function UploadBox({ onDraft }) {
  const [kind, setKind] = useState("pnl");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const mediaType = file.type === "application/pdf" || /\.pdf$/i.test(file.name) ? "application/pdf"
      : /\.(csv|txt)$/i.test(file.name) || file.type === "text/csv" ? "text/csv" : file.type;
    if (!UPLOAD_MEDIA_TYPES.includes(mediaType)) { setError("Upload a PDF or CSV file. For Excel, save as CSV first."); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setError("Files are limited to 8 MB."); return; }
    setBusy(true); setError("");
    try {
      const base64 = await readAsBase64(file);
      const res = await invoke("uploadFinancialDocument", { file_name: file.name, media_type: mediaType, kind, base64 });
      onDraft(res.data.upload);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-5 rounded-2xl" style={card}>
      <h3 className="font-bold flex items-center gap-2"><Upload className="w-4 h-4" aria-hidden="true" /> Add a month</h3>
      <p className="mt-1 text-sm" style={muted}>
        Upload a P&amp;L, payroll report, bank statement or POS sales report (PDF or CSV). We read the figures, you check them before anything is saved.
      </p>
      <div className="mt-4 flex flex-wrap gap-3 items-center">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.14)", color: "#fff" }}>
          {UPLOAD_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <label className="text-sm font-semibold px-4 py-2 rounded-full cursor-pointer inline-flex items-center gap-2"
          style={{ background: "#f0b429", color: "#0b0b0d" }}>
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading…</> : <><FileText className="w-4 h-4" /> Choose file</>}
          <input type="file" accept=".pdf,.csv,.txt,application/pdf,text/csv" className="sr-only" onChange={onFile} disabled={busy} />
        </label>
        <span className="text-xs" style={muted}>or enter a month by hand below</span>
      </div>
      {error && <p className="mt-3 text-sm" style={{ color: "#e5484d" }}>{error}</p>}
    </div>
  );
}

export default function FinanceModule({ view, ratings, threshold }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [review, setReview] = useState(null); // { draft, uploadIds }
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightError, setInsightError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await invoke("getFinanceData", {});
      setData(res.data);
      setLoadError("");
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const latest = data?.snapshots?.[0] || null;
  const latestKpis = useMemo(() => (latest ? kpis(latest) : null), [latest]);
  const latestGuests = useMemo(
    () => (latest ? guestMonth(ratings, normalizeMonth(latest.month), threshold) : null),
    [latest, ratings, threshold],
  );

  const generate = async () => {
    setInsightBusy(true); setInsightError("");
    try {
      const res = await invoke("generateCombinedInsights", {});
      setData((d) => ({ ...d, latest_insight: res.data }));
    } catch (err) {
      setInsightError(errorText(err));
    } finally {
      setInsightBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="mt-8 p-5 rounded-2xl flex gap-3" style={card}>
        <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: "#e5484d" }} />
        <p className="text-sm">{loadError}</p>
      </div>
    );
  }
  if (!data) return <div className="mt-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  if (view === "overview") {
    return (
      <div className="mt-8">
        {latest ? (
          <>
            <h2 className="text-lg font-bold">{monthLabel(latest.month)} at a glance</h2>
            <p className="text-xs mt-1" style={muted}>Your latest confirmed month, and your guest ratings from the same month.</p>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile label="Revenue" value={usd(latestKpis.revenue)} />
              <Tile label="Prime cost" value={pct(latestKpis.prime_cost_pct)} hint="Food, bev & labor ÷ revenue" />
              <Tile label="Labor" value={pct(latestKpis.labor_pct)} hint="of revenue" />
              <Tile label="Net margin" value={pct(latestKpis.net_margin)} />
              <Tile label="Guest ratings" value={latestGuests.ratings} hint={latestGuests.avg_stars == null ? "" : `${latestGuests.avg_stars.toFixed(2)} average`} />
              <Tile label="Low ratings" value={latestGuests.low_ratings} hint={`at or below ${threshold} stars`} />
              <Tile label="Recovery rate" value={pct(latestGuests.recovery_rate)} hint={`${latestGuests.untouched_alerts} not handled`} />
              <Tile label="Google taps" value={latestGuests.google_taps} />
            </div>
          </>
        ) : (
          <p className="text-sm" style={muted}>No confirmed months yet. Open the Finances tab to add your first one.</p>
        )}
        <Insights data={data.latest_insight} onGenerate={generate} busy={insightBusy} error={insightError}
          canGenerate={Boolean(latest) && data.claude_configured} />
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      {!data.claude_configured && (
        <p className="text-sm p-4 rounded-2xl" style={card}>
          Document reading isn&apos;t switched on yet. You can still enter months by hand.
        </p>
      )}
      {data.claude_configured && !review && (
        <UploadBox onDraft={(upload) => setReview({ draft: upload.extracted, uploadIds: [upload.id] })} />
      )}
      {!review && (
        <button type="button" onClick={() => setReview({ draft: null, uploadIds: [] })} className="text-sm underline" style={muted}>
          Enter a month by hand
        </button>
      )}
      {review && (
        <ReviewForm draft={review.draft} uploadIds={review.uploadIds}
          onCancel={() => setReview(null)}
          onSaved={() => { setReview(null); load(); }} />
      )}

      <section className="p-5 rounded-2xl overflow-x-auto" style={card}>
        <h3 className="font-bold">Confirmed months</h3>
        {data.snapshots.length === 0 ? (
          <p className="mt-2 text-sm" style={muted}>Nothing confirmed yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm min-w-[560px]">
            <thead>
              <tr style={muted}>
                <th className="text-left py-2 font-normal">Month</th>
                <th className="text-right font-normal">Revenue</th>
                <th className="text-right font-normal">Food &amp; bev</th>
                <th className="text-right font-normal">Labor</th>
                <th className="text-right font-normal">Prime cost</th>
                <th className="text-right font-normal">Net margin</th>
              </tr>
            </thead>
            <tbody>
              {data.snapshots.map((s) => {
                const k = kpis(s);
                return (
                  <tr key={s.month} style={{ borderTop: "1px solid rgba(255,255,255,.07)" }}>
                    <td className="py-2">{monthLabel(s.month)}</td>
                    <td className="text-right">{usd(k.revenue)}</td>
                    <td className="text-right">{pct(k.cogs_pct)}</td>
                    <td className="text-right">{pct(k.labor_pct)}</td>
                    <td className="text-right">{pct(k.prime_cost_pct)}</td>
                    <td className="text-right">{pct(k.net_margin)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {data.uploads.length > 0 && (
        <section className="p-5 rounded-2xl" style={card}>
          <h3 className="font-bold">Recent uploads</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {data.uploads.map((u) => (
              <li key={u.id} className="flex justify-between gap-3">
                <span className="truncate">{u.file_name}</span>
                <span style={muted}>{{ extracted: "Waiting for you to confirm", confirmed: "Confirmed", failed: "Couldn't read", discarded: "Discarded" }[u.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

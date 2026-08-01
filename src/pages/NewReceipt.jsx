import { useState } from "react";
import * as Sentry from "@sentry/react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Upload, Loader2, Wand2, X, Plus, AlertCircle, Zap, Pencil, Check, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import TipSelector from "@/components/TipSelector";
import SplitModeSelector from "@/components/SplitModeSelector";
import DesktopWarningModal from "@/components/DesktopWarningModal";
import { trackDeviceAction } from "@/lib/deviceAnalytics";
import { compressImage } from "@/lib/compressImage";

const RESTAURANT_SUGGESTIONS = [
  "McDonald's", "Chipotle", "Chick-fil-A", "Cheesecake Factory",
  "Olive Garden", "Applebee's", "Domino's", "Subway", "Panera Bread",
  "Buffalo Wild Wings", "IHOP", "Denny's", "Outback Steakhouse",
  "Red Lobster", "Texas Roadhouse", "P.F. Chang's", "Five Guys",
  "Shake Shack", "In-N-Out", "Raising Cane's"
];

const isDesktop = !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

/** One line of the receipt: what it was on the left, what it cost on the right. */
function MoneyRow({ label, amount, muted }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className={`text-[15px] leading-snug ${muted ? "text-muted-foreground" : "text-foreground"}`}>
        {label}
      </span>
      <span className="font-semibold text-[15px] text-foreground tabular-nums shrink-0">
        ${amount.toFixed(2)}
      </span>
    </div>
  );
}

export default function NewReceipt() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [title, setTitle] = useState("");
  const [items, setItems] = useState([]);
  const [tax, setTax] = useState(0);
  const [tip, setTip] = useState(0);
  const [splitMode, setSplitMode] = useState("itemized");
  const [saving, setSaving] = useState(false);
  const [dismissedDesktopWarning, setDismissedDesktopWarning] = useState(false);
  const [parseValidation, setParseValidation] = useState(null);
  const [titleSuggestions, setTitleSuggestions] = useState([]);
  const [showQuickEven, setShowQuickEven] = useState(false);
  const [quickTotal, setQuickTotal] = useState("");
  /**
   * The review screen opens read-only.
   *
   * It used to open with every item as two text inputs — an eight-item receipt
   * meant nineteen editable fields, which reads as an instruction to check all
   * nineteen. Almost nobody needs to: the scan is usually right. Showing the
   * receipt as a receipt makes the default action "does this look like what I
   * ate? yes" instead of "audit this form". Editing is one tap away, and opens
   * by itself below when the parse is known to be shaky.
   */
  const [editing, setEditing] = useState(false);

  const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const validateAndSetFile = (file) => {
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type) && !file.name.match(/\.(jpe?g|png|webp|heic|heif)$/i)) {
      alert("Please upload a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      alert("Image must be under 10MB.");
      return;
    }
    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
  };

  const handleFileChange = (e) => {
    validateAndSetFile(e.target.files[0]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    validateAndSetFile(e.dataTransfer.files[0]);
  };

  const handleParseReceipt = async () => {
    if (!imageFile) return;
    try {
      setUploading(true);
      // Downscale first. A phone photo is 4032x3024 and several megabytes, and
      // all of it was being pushed over a restaurant's wifi before the OCR
      // model even started. The upload was most of the wait. 2000px on the long
      // edge keeps receipt line items legible and typically cuts the payload by
      // an order of magnitude; it returns the original if anything goes wrong.
      const upload = await compressImage(imageFile);
      const { file_url } = await base44.integrations.Core.UploadFile({ file: upload });
      setUploading(false);
      setParsing(true);

      const result = await base44.integrations.Core.InvokeLLM({
        model: "gemini_3_flash",
        prompt: `Analyze this receipt image and extract all line items with their prices. Also extract tax, tip, and total if present.
Return a JSON with:
- title: short restaurant/store name if visible, else "Receipt"
- items: array of {name: string, price: number, quantity: number}
- tax: number (0 if not found)
- tip: number (0 if not found)
- total: number`,
        file_urls: [file_url],
        response_json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, price: { type: "number" }, quantity: { type: "number" } } } },
            tax: { type: "number" },
            tip: { type: "number" },
            total: { type: "number" }
          }
        }
      });

      // In its own catch. This is an advisory "does the arithmetic look right"
      // check, and it sat bare inside the upload handler — so when it threw,
      // the OCR parse above it was discarded with it and the guest was told the
      // upload had failed. A missing sanity check is worth far less than the
      // parse it was sanity-checking.
      let validation = null;
      try {
        validation = await base44.functions.invoke("validateReceiptParse", {
          items: result.items || [],
          tax: result.tax || 0,
          tip: result.tip || 0,
          total: result.total || 0
        });
      } catch {
        /* Advisory only — keep the parse. */
      }

      setTitle(result.title || "Receipt");
      setItems((result.items || []).map((item, i) => ({ ...item, id: `item-${i}`, claimed_by: [] })));
      setTax(result.tax || 0);
      setTip(result.tip || 0);
      setImageUrl(file_url);
      if (validation?.data) setParseValidation(validation.data);
      // Only pre-open the editor when we already know the numbers are suspect.
      // Anything else and the diner is being asked to fix what is not broken.
      setEditing(validation?.data?.confidence === 'low' || (result.items || []).length === 0);
      setStep(2);
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'receipt_scanned', { items_count: (result.items || []).length });
      }
    } catch (err) {
      console.error("Failed to parse receipt:", err);
      Sentry.captureException(err, { tags: { feature: 'receipt_scan' } });
      alert("Failed to process receipt. Please try again.");
    } finally {
      setUploading(false);
      setParsing(false);
    }
  };

  const updateItem = (i, field, value) => setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const addItem = () => setItems(prev => [...prev, { id: `item-${Date.now()}`, name: "", price: 0, quantity: 1, claimed_by: [] }]);

  /**
   * Where to send someone once their split exists.
   *
   * /session-host is inside <ProtectedRoute> and additionally redirects to /
   * when unauthenticated, so a guest who came from a table tent — the one
   * person this page was deliberately opened up for — was bounced to /login and
   * then off the flow entirely. They have no account and are not going to make
   * one while their table waits.
   *
   * /claim?id= is the same session without the host-only controls, which is
   * everything a guest needs: their own items, their share, and the pay button.
   * The signed-in host still gets the full host view.
   */
  const afterCreate = async (sessionId) => {
    let authed = false;
    try {
      authed = await base44.auth.isAuthenticated();
    } catch {
      /* Treat an unanswerable auth check as "guest" — /claim works for both. */
    }
    navigate(authed ? `/session-host?id=${sessionId}` : `/claim?id=${sessionId}`);
  };

  const handleCreateSession = async () => {
    setSaving(true);
    try {
      const restaurantSlug = sessionStorage.getItem("billtap_restaurant_slug");
      const res = await base44.functions.invoke("createSession", {
        title,
        image_url: imageUrl,
        items,
        tax,
        tip,
        split_mode: splitMode,
        total_amount: total,
        ...(restaurantSlug ? { restaurant_slug: restaurantSlug } : {}),
      });
      if (res.data?.error) {
        alert(res.data.error);
        setSaving(false);
        return;
      }
      const session = res.data.session;
      Sentry.addBreadcrumb({ category: 'session', message: 'Bill split session created', level: 'info' });
      Sentry.setTag('split_mode', splitMode);
      trackDeviceAction('split_created');
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'session_created', { session_id: session.id, split_mode: splitMode });
      }
      await afterCreate(session.id);
    } catch (err) {
      console.error("Failed to create session:", err);
      Sentry.captureException(err, { tags: { feature: 'join_session' } });
      alert("Failed to create session. Please try again.");
      setSaving(false);
    }
  };

  const handleTitleChange = (val) => {
    setTitle(val);
    if (val.length >= 2) {
      const q = val.toLowerCase();
      setTitleSuggestions(RESTAURANT_SUGGESTIONS.filter(r => r.toLowerCase().includes(q)).slice(0, 4));
    } else {
      setTitleSuggestions([]);
    }
  };

  const handleQuickEvenCreate = async () => {
    const amt = parseFloat(quickTotal);
    if (!amt || amt <= 0) return;
    setSaving(true);
    try {
      const restaurantSlug = sessionStorage.getItem("billtap_restaurant_slug");
      const res = await base44.functions.invoke("createSession", {
        title: title || "Quick Split",
        items: [],
        tax: 0,
        tip: 0,
        split_mode: "even",
        total_amount: amt,
        ...(restaurantSlug ? { restaurant_slug: restaurantSlug } : {}),
      });
      if (res.data?.error) { alert(res.data.error); setSaving(false); return; }
      trackDeviceAction('split_created');
      await afterCreate(res.data.session.id);
    } catch (err) {
      Sentry.captureException(err);
      alert("Failed to create session.");
      setSaving(false);
    }
  };

  const subtotal = items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
  const total = subtotal + (tax || 0) + (tip || 0);
  const pageUrl = `${window.location.origin}/new-receipt`;

  return (
    <div className="min-h-screen bg-background pb-28">
      {isDesktop && !dismissedDesktopWarning && (
        <DesktopWarningModal url={pageUrl} onDismiss={() => setDismissedDesktopWarning(true)} />
      )}

      {/* Hero Header */}
      <div
        className="relative overflow-hidden px-5 pt-10 pb-8"
        style={{ background: 'linear-gradient(160deg, #0f0c29 0%, #302b63 60%, #1a1535 100%)' }}
      >
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div style={{ position: 'absolute', top: '-20%', right: '-10%', width: '45vw', height: '45vw', maxWidth: 280, maxHeight: 280, borderRadius: '50%', background: 'radial-gradient(circle, rgba(102,126,234,0.45) 0%, transparent 70%)', filter: 'blur(45px)' }} />
        </div>
        <div className="relative z-10 max-w-2xl mx-auto">
          <h1 className="text-2xl font-black text-white tracking-tight">New Split</h1>
          <p className="text-white/60 text-sm mt-1">
            {step === 1 ? "Take a photo of the receipt" : "Check it looks right, then share the code"}
          </p>
          {/* Step indicator */}
          <div className="flex gap-4 mt-4">
            {["Take a photo", "Check it"].map((s, i) => (
              <div key={s} className={`flex items-center gap-2 text-sm font-semibold ${step === i + 1 ? "text-white" : step > i + 1 ? "text-emerald-400" : "text-white/30"}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${step === i + 1 ? "bg-white text-purple-700" : step > i + 1 ? "bg-emerald-500 text-white" : "bg-white/10 text-white/30"}`}>{i + 1}</div>
                {s}
                {i < 1 && <span className="text-white/20 ml-1">›</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-5 space-y-4">

        {/* Scanning animation overlay */}
        {(uploading || parsing) && imageUrl && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6" style={{ background: 'rgba(10,8,30,0.92)', backdropFilter: 'blur(8px)' }}>
            <div className="relative w-full max-w-xs rounded-2xl overflow-hidden" style={{ maxHeight: 300 }}>
              <img src={imageUrl} alt="Receipt being scanned" className="w-full object-cover rounded-2xl opacity-60" style={{ maxHeight: 300 }} />
              {/* Animated scan line */}
              <div
                className="absolute left-0 right-0 h-0.5"
                style={{
                  background: 'linear-gradient(90deg, transparent, #667eea, #f093fb, transparent)',
                  animation: 'scanline 1.8s ease-in-out infinite',
                  top: '0%',
                }}
              />
              <style>{`@keyframes scanline { 0%{top:0%} 50%{top:95%} 100%{top:0%} }`}</style>
            </div>
            <div className="mt-6 text-center space-y-2">
              <p className="text-white font-bold text-lg">{uploading ? "Uploading receipt…" : "Reading your receipt…"}</p>
              <div className="flex items-center justify-center gap-1.5">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full bg-brand"
                    style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
                  />
                ))}
              </div>
              <style>{`@keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }`}</style>
            </div>
          </div>
        )}

        {step === 1 && (
          <>
          {/* Quick Even Split shortcut */}
          <button
            onClick={() => setShowQuickEven(v => !v)}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-all active:scale-[0.99]"
            style={{ background: 'rgba(102,126,234,0.08)', border: '1px solid rgba(102,126,234,0.2)' }}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #667eea, #f093fb)' }}>
              <Zap className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white text-sm">Skip setup → Just split evenly</p>
              <p className="text-xs text-white/40">Enter total, share QR — done in one tap</p>
            </div>
            <span className="text-white/30 text-lg">{showQuickEven ? "▲" : "▼"}</span>
          </button>

          {showQuickEven && (
            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(102,126,234,0.06)', border: '1px solid rgba(102,126,234,0.15)' }}>
              <div className="space-y-2">
                <Label htmlFor="quick-name" className="text-xs text-white/50">Restaurant / occasion name</Label>
                <Input id="quick-name" value={title} onChange={e => handleTitleChange(e.target.value)} placeholder="e.g. Dinner at Chipotle" className="rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-total" className="text-xs text-white/50">Total bill amount</Label>
                <Input id="quick-total" type="number" inputMode="decimal" value={quickTotal} onChange={e => setQuickTotal(e.target.value)} placeholder="$0.00" className="rounded-xl text-lg font-bold" />
              </div>
              <button
                onClick={handleQuickEvenCreate}
                disabled={saving || !quickTotal || parseFloat(quickTotal) <= 0}
                className="w-full h-12 text-white font-black rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg, #667eea, #f093fb)' }}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Zap className="w-4 h-4" /> Generate QR Code →</>}
              </button>
            </div>
          )}

          <div
            className="rounded-2xl p-6 space-y-4"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload receipt photo"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && document.getElementById("file-input").click()}
              className="border-2 border-dashed border-brand/30 rounded-2xl p-10 text-center cursor-pointer hover:border-brand/60 transition-colors bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              onClick={() => document.getElementById("file-input").click()}
            >
              {imageUrl ? (
                <img src={imageUrl} alt="Receipt" loading="lazy" decoding="async" className="max-h-64 mx-auto rounded-xl object-contain" />
              ) : (
                <>
                  <Upload className="w-12 h-12 mx-auto text-brand/50 mb-3" aria-hidden="true" />
                  <p className="text-foreground font-semibold">Drop receipt photo here or click to upload</p>
                  <p className="text-muted-foreground text-sm mt-1">JPG, PNG, HEIC supported</p>
                </>
              )}
            </div>
            <input id="file-input" type="file" accept="image/*" className="sr-only" onChange={handleFileChange} aria-label="Upload receipt image" />
            <button
              onClick={handleParseReceipt}
              disabled={!imageFile || uploading || parsing}
              className="w-full h-14 text-white font-black text-base rounded-2xl flex items-center justify-center gap-2 shadow-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0"
              style={{ background: 'linear-gradient(135deg, #f5576c, #f093fb, #667eea)' }}
            >
              {uploading ? <><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Uploading…</> :
               parsing   ? <><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Analyzing receipt…</> :
                           <><Wand2 className="w-5 h-5" aria-hidden="true" /> Parse Receipt with AI</>}
              {(uploading || parsing) && <span className="sr-only" role="status" aria-live="polite">{uploading ? "Uploading receipt image" : "Analyzing receipt with AI."}</span>}
            </button>
          </div>
          </>
        )}

        {step === 2 && (
          <div className="space-y-4">

            {/* Only speak up when there is something wrong. A banner on a clean
                parse trains people to ignore the banner on a bad one. */}
            {parseValidation?.confidence === 'low' && (
              <div className="bg-danger-muted border border-destructive/30 rounded-2xl p-4 text-danger-muted-foreground text-sm flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-bold">This receipt was hard to read</p>
                  <p className="mt-1">Please check the prices below before you share the code.</p>
                  {parseValidation.issues?.sumMismatch && (
                    <p className="mt-1 text-xs">
                      The items add up to ${parseValidation.issues.calculatedTotal}, but the receipt says ${parseValidation.issues.expectedTotal}.
                    </p>
                  )}
                </div>
              </div>
            )}
            {parseValidation?.confidence === 'medium' && (
              <div className="bg-warning-muted border border-warning/30 rounded-2xl p-4 text-warning-muted-foreground text-sm flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" aria-hidden="true" />
                <p className="font-bold">Give the prices a quick look before sharing.</p>
              </div>
            )}

            {/* The receipt, shown as a receipt */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <div className="px-5 pt-5 pb-1">
                {editing ? (
                  <div className="relative">
                    <Label htmlFor="bill-title" className="text-sm text-muted-foreground">Where were you?</Label>
                    <Input id="bill-title" value={title} onChange={e => handleTitleChange(e.target.value)} className="mt-1 rounded-xl" autoComplete="off" />
                    {titleSuggestions.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl overflow-hidden" style={{ background: '#1a1535', border: '1px solid rgba(255,255,255,0.12)' }}>
                        {titleSuggestions.map(s => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => { setTitle(s); setTitleSuggestions([]); }}
                            className="w-full text-left px-4 py-3 text-sm text-white hover:bg-white/10 transition-colors"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <h2 className="text-xl font-black text-foreground truncate">{title || "Receipt"}</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {items.length === 1 ? "1 item" : `${items.length} items`}
                    </p>
                  </>
                )}
              </div>

              <div className="px-5 py-3">
                {editing ? (
                  <div className="space-y-2">
                    {items.map((item, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input value={item.name} onChange={e => updateItem(i, "name", e.target.value)} placeholder="Item name" aria-label={`Item ${i + 1} name`} className="flex-1 min-w-0 rounded-xl text-sm" />
                        {/* w-24 clipped the cents — "19.95" rendered as "19.9", which is
                            the one thing on this screen that must never be misread. The
                            box is narrower than it looks: the root font-size is fluid, so
                            6rem is 84px here, and index.css gives every number input 16px
                            of side padding via input[type="number"] — an attribute
                            selector, which outranks a px-* utility. Hence extra width
                            rather than less padding. */}
                        <Input type="number" inputMode="decimal" value={item.price} onChange={e => updateItem(i, "price", parseFloat(e.target.value) || 0)} placeholder="Price" aria-label={`Item ${i + 1} price`} className="w-28 shrink-0 rounded-xl text-sm text-right tabular-nums" />
                        <button onClick={() => removeItem(i)} aria-label={`Remove ${item.name || `item ${i + 1}`}`} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors rounded-lg">
                          <X className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                    <Button variant="outline" onClick={addItem} className="w-full rounded-xl h-11">
                      <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> Add an item
                    </Button>
                    <div className="pt-2">
                      <Label htmlFor="tax-input" className="text-sm text-muted-foreground">Tax</Label>
                      <Input id="tax-input" type="number" inputMode="decimal" value={tax} onChange={e => setTax(parseFloat(e.target.value) || 0)} className="mt-1 rounded-xl" />
                    </div>
                  </div>
                ) : items.length > 0 ? (
                  <ul className="divide-y divide-white/[0.06]">
                    {items.map((item, i) => (
                      <li key={i}>
                        <MoneyRow
                          label={(item.quantity || 1) > 1 ? `${item.quantity}× ${item.name}` : item.name}
                          amount={item.price * (item.quantity || 1)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground py-2">
                    No items yet — tap <span className="font-semibold text-foreground">Change something</span> below to add them.
                  </p>
                )}
              </div>

              {/* The money, always visible — this is the part people actually read */}
              <div className="px-5 py-4 border-t border-white/10" style={{ background: 'rgba(255,255,255,0.02)' }}>
                {/* A "$0.00" line is noise. Only show what was actually charged. */}
                {!editing && tax > 0 && <MoneyRow label="Tax" amount={tax} muted />}
                {tip > 0 && <MoneyRow label="Tip" amount={tip} muted />}
                <div className="flex items-baseline justify-between gap-4 pt-3 mt-2 border-t border-white/10">
                  <span className="font-bold text-foreground">Total</span>
                  <span className="font-black text-3xl text-brand tabular-nums">${total.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setEditing(v => !v)}
              className="w-full min-h-[48px] rounded-2xl flex items-center justify-center gap-2 font-semibold text-sm transition-all active:scale-[0.99] bg-white/[0.04] border border-white/10 text-foreground hover:bg-white/[0.08]"
            >
              {editing
                ? <><Check className="w-4 h-4" aria-hidden="true" /> Looks good, I&apos;m done</>
                : <><Pencil className="w-4 h-4" aria-hidden="true" /> Change something</>}
            </button>

            <div className="pt-1">
              <h3 className="font-bold text-foreground mb-2">Add a tip?</h3>
              <TipSelector subtotal={subtotal} tip={tip} onChange={setTip} />
            </div>

            <div className="pt-1">
              <SplitModeSelector value={splitMode} onChange={setSplitMode} />
            </div>

            <button
              onClick={handleCreateSession}
              disabled={saving || (splitMode === "itemized" && items.length === 0)}
              className="w-full h-14 text-white font-black text-base rounded-2xl flex items-center justify-center gap-2 shadow-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0"
              style={{ background: 'linear-gradient(135deg, #f5576c, #f093fb, #667eea)' }}
            >
              {saving
                ? <><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Making your code…</>
                : <><QrCode className="w-5 h-5" aria-hidden="true" /> Show the QR code</>}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              Everyone at the table scans it — no app, no sign-up.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
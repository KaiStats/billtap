import { useState, useCallback, useRef } from "react";
import * as Sentry from "@sentry/react";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { useTabNav } from "@/lib/TabNavigationContext";
import { Upload, Loader2, Wand2, X, Plus, AlertCircle, Zap, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import TipSelector from "@/components/TipSelector";
import SplitModeSelector from "@/components/SplitModeSelector";
import DesktopWarningModal from "@/components/DesktopWarningModal";
import { trackDeviceAction } from "@/lib/deviceAnalytics";

const RESTAURANT_SUGGESTIONS = [
  "McDonald's", "Chipotle", "Chick-fil-A", "Cheesecake Factory",
  "Olive Garden", "Applebee's", "Domino's", "Subway", "Panera Bread",
  "Buffalo Wild Wings", "IHOP", "Denny's", "Outback Steakhouse",
  "Red Lobster", "Texas Roadhouse", "P.F. Chang's", "Five Guys",
  "Shake Shack", "In-N-Out", "Raising Cane's"
];

const isDesktop = !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export default function NewReceipt() {
  const { pushScreen } = useTabNav();
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
      const { file_url } = await base44.integrations.Core.UploadFile({ file: imageFile });
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

      const validation = await base44.functions.invoke("validateReceiptParse", {
        items: result.items || [],
        tax: result.tax || 0,
        tip: result.tip || 0,
        total: result.total || 0
      });

      setTitle(result.title || "Receipt");
      setItems((result.items || []).map((item, i) => ({ ...item, id: `item-${i}`, claimed_by: [] })));
      setTax(result.tax || 0);
      setTip(result.tip || 0);
      setImageUrl(file_url);
      if (validation.data) setParseValidation(validation.data);
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

  const handleCreateSession = async () => {
    setSaving(true);
    try {
      const res = await base44.functions.invoke("createSession", {
        title, 
        image_url: imageUrl, 
        items, 
        tax, 
        tip, 
        split_mode: splitMode, 
        total_amount: total,
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
      pushScreen(createPageUrl(`SessionHost?id=${session.id}`));
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
      const res = await base44.functions.invoke("createSession", {
        title: title || "Quick Split",
        items: [],
        tax: 0,
        tip: 0,
        split_mode: "even",
        total_amount: amt,
      });
      if (res.data?.error) { alert(res.data.error); setSaving(false); return; }
      trackDeviceAction('split_created');
      pushScreen(createPageUrl(`SessionHost?id=${res.data.session.id}`));
    } catch (err) {
      Sentry.captureException(err);
      alert("Failed to create session.");
      setSaving(false);
    }
  };

  const subtotal = items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
  const total = subtotal + (tax || 0) + (tip || 0);
  const pageUrl = `${window.location.origin}/NewReceipt`;

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
          <p className="text-white/60 text-sm mt-1">Scan a receipt to get started</p>
          {/* Step indicator */}
          <div className="flex gap-4 mt-4">
            {["📸 Photo", "✏️ Review"].map((s, i) => (
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
          <div
            className="rounded-2xl p-6 space-y-4"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            {parseValidation?.confidence === 'low' && (
              <div className="bg-danger-muted border border-destructive/30 rounded-xl p-3 text-danger-muted-foreground text-sm flex items-start gap-2">
                <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-bold">⚠️ We had trouble reading this receipt clearly</p>
                  <p className="mt-1 text-xs">Please review each item carefully before continuing.</p>
                  {parseValidation.issues?.sumMismatch && <p className="mt-1 text-xs">• Total mismatch: items add up to ${parseValidation.issues.calculatedTotal}, but receipt shows ${parseValidation.issues.expectedTotal}</p>}
                </div>
              </div>
            )}
            {parseValidation?.confidence === 'medium' && (
              <div className="bg-warning-muted border border-warning/30 rounded-xl p-3 text-warning-muted-foreground text-sm flex items-start gap-2">
                <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" aria-hidden="true" />
                <div><p className="font-bold">⚠️ Please double-check the items below</p></div>
              </div>
            )}
            <div className="bg-success-muted border border-success/20 rounded-xl p-3 text-success-muted-foreground text-sm font-medium flex items-center gap-2">
              ✅ Found {items.length} items — fix anything that looks wrong
            </div>

            <div className="relative">
              <Label htmlFor="bill-title" className="text-sm text-muted-foreground">Bill title</Label>
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

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">Line Items</Label>
                <Button size="sm" variant="outline" onClick={addItem} className="rounded-lg text-xs h-8">
                  <Plus className="w-3 h-3 mr-1" aria-hidden="true" /> Add
                </Button>
              </div>
              {items.map((item, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input value={item.name} onChange={e => updateItem(i, "name", e.target.value)} placeholder="Item name" aria-label={`Item ${i + 1} name`} className="flex-1 rounded-xl text-sm" />
                  <Input type="number" inputMode="decimal" value={item.price} onChange={e => updateItem(i, "price", parseFloat(e.target.value) || 0)} placeholder="Price" aria-label={`Item ${i + 1} price`} className="w-24 rounded-xl text-sm" />
                  <button onClick={() => removeItem(i)} aria-label={`Remove ${item.name || `item ${i + 1}`}`} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors rounded-lg">
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>

            <div>
              <Label htmlFor="tax-input" className="text-sm text-muted-foreground">Tax</Label>
              <Input id="tax-input" type="number" inputMode="decimal" value={tax} onChange={e => setTax(parseFloat(e.target.value) || 0)} className="mt-1 rounded-xl" />
            </div>

            <div>
              <Label className="mb-2 block text-sm text-muted-foreground">Tip</Label>
              <TipSelector subtotal={subtotal} tip={tip} onChange={setTip} />
            </div>

            {/* Split Mode Selector */}
            <div className="pt-2">
              <SplitModeSelector value={splitMode} onChange={setSplitMode} />
            </div>

            {/* Custom Split Info */}
            {splitMode === "custom" && (
              <div className="pt-4 border-t border-white/10">
                <div className="rounded-xl p-4 bg-purple-500/10 border border-purple-500/20 text-purple-300 text-sm">
                  <p className="font-bold mb-2">📊 Custom Split Setup</p>
                  <p className="text-xs opacity-80">
                    Generate the QR code first. After guests join by scanning, you can configure custom percentages, 
                    fixed amounts, or shares from the Session Host screen.
                  </p>
                </div>
              </div>
            )}



            {/* Total */}
            <div
              className="rounded-xl p-4 flex items-center justify-between"
              style={{ background: 'rgba(102,126,234,0.08)', border: '1px solid rgba(102,126,234,0.2)' }}
            >
              <span className="text-muted-foreground font-medium">Total</span>
              <span className="font-black text-2xl text-brand">${total.toFixed(2)}</span>
            </div>

            <button
              onClick={handleCreateSession}
              disabled={saving || (splitMode === "itemized" && items.length === 0)}
              className="w-full h-14 text-white font-black text-base rounded-2xl flex items-center justify-center gap-2 shadow-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0"
              style={{ background: 'linear-gradient(135deg, #f5576c, #f093fb, #667eea)' }}
            >
              {saving ? <><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Creating session…</> : "🔗 Generate QR Code →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
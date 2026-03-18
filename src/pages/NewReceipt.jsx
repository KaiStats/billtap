import { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { useTabNav } from "@/lib/TabNavigationContext";
import { Upload, Loader2, Wand2, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import TipSelector from "@/components/TipSelector";

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
  const [saving, setSaving] = useState(false);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) { setImageFile(file); setImageUrl(URL.createObjectURL(file)); }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) { setImageFile(file); setImageUrl(URL.createObjectURL(file)); }
  };

  const handleParseReceipt = async () => {
    if (!imageFile) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file: imageFile });
    setUploading(false);
    setParsing(true);

    const result = await base44.integrations.Core.InvokeLLM({
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

    setTitle(result.title || "Receipt");
    setItems((result.items || []).map((item, i) => ({ ...item, id: `item-${i}`, claimed_by: [] })));
    setTax(result.tax || 0);
    setTip(result.tip || 0);
    setParsing(false);
    setImageUrl(file_url);
    setStep(2);
  };

  const updateItem = (i, field, value) => setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const addItem = () => setItems(prev => [...prev, { id: `item-${Date.now()}`, name: "", price: 0, quantity: 1, claimed_by: [] }]);

  const handleCreateSession = async () => {
    setSaving(true);
    const subtotal = items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
    const total = subtotal + (tax || 0) + (tip || 0);

    const session = await base44.entities.Session.create({
      title,
      image_url: imageUrl,
      total_amount: total,
      tax,
      tip,
      items,
      participants: [],
      status: "waiting"
    });

    pushScreen(createPageUrl(`SessionHost?id=${session.id}`));
  };

  const subtotal = items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
  const total = subtotal + (tax || 0) + (tip || 0);

  return (
    <div className="min-h-screen bg-surface p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-black text-foreground">New Split</h2>
          <div className="flex gap-3 mt-3">
            {["📸 Photo", "✏️ Review"].map((s, i) => (
              <div key={s} className={`flex items-center gap-1 text-sm font-semibold ${step === i + 1 ? "text-brand" : step > i + 1 ? "text-success" : "text-muted-foreground"}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === i + 1 ? "bg-brand text-brand-foreground" : step > i + 1 ? "bg-success text-success-muted-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</div>
                {s}
                {i < 1 && <span className="text-muted-foreground ml-1">›</span>}
              </div>
            ))}
          </div>
        </div>

        {step === 1 && (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div
                role="button"
                tabIndex={0}
                aria-label="Upload receipt photo"
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && document.getElementById("file-input").click()}
                className="border-2 border-dashed border-brand/30 rounded-2xl p-10 text-center cursor-pointer hover:border-brand/60 transition-colors bg-brand-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                onClick={() => document.getElementById("file-input").click()}
              >
                {imageUrl ? (
                  <img src={imageUrl} alt="Receipt" className="max-h-64 mx-auto rounded-xl object-contain" />
                ) : (
                  <>
                    <Upload className="w-12 h-12 mx-auto text-brand/40 mb-3" aria-hidden="true" />
                    <p className="text-foreground font-medium">Drop receipt photo here or click to upload</p>
                    <p className="text-muted-foreground text-sm mt-1">JPG, PNG, HEIC supported</p>
                  </>
                )}
              </div>
              <input id="file-input" type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              <Button
                onClick={handleParseReceipt}
                disabled={!imageFile || uploading || parsing}
                className="w-full bg-brand hover:bg-brand/90 text-brand-foreground font-bold rounded-xl h-12 text-base"
              >
                {uploading ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" aria-hidden="true" /> Uploading...</> :
                  parsing ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" aria-hidden="true" /> AI is reading your receipt...</> :
                    <><Wand2 className="mr-2 w-4 h-4" aria-hidden="true" /> Parse Receipt with AI</>}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div className="bg-success-muted border border-success/30 rounded-xl p-3 text-success-muted-foreground font-semibold text-sm flex items-center gap-2">
                ✅ Found {items.length} items — fix anything that looks wrong
              </div>
              <div>
                <Label htmlFor="bill-title">Bill title</Label>
                <Input id="bill-title" value={title} onChange={e => setTitle(e.target.value)} className="mt-1 rounded-xl" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Line Items</Label>
                  <Button size="sm" variant="outline" onClick={addItem} className="rounded-lg text-xs">
                    <Plus className="w-3 h-3 mr-1" aria-hidden="true" /> Add
                  </Button>
                </div>
                {items.map((item, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input
                      value={item.name}
                      onChange={e => updateItem(i, "name", e.target.value)}
                      placeholder="Item name"
                      aria-label={`Item ${i + 1} name`}
                      className="flex-1 rounded-xl text-sm"
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={item.price}
                      onChange={e => updateItem(i, "price", parseFloat(e.target.value) || 0)}
                      placeholder="Price"
                      aria-label={`Item ${i + 1} price`}
                      className="w-24 rounded-xl text-sm"
                    />
                    <button
                      onClick={() => removeItem(i)}
                      aria-label={`Remove ${item.name || `item ${i + 1}`}`}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors rounded-lg active:bg-accent"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex-1">
                <Label htmlFor="tax-input">Tax</Label>
                <Input id="tax-input" type="number" inputMode="decimal" value={tax} onChange={e => setTax(parseFloat(e.target.value) || 0)} className="mt-1 rounded-xl" />
              </div>
              <div>
                <Label className="mb-2 block">Tip</Label>
                <TipSelector subtotal={subtotal} tip={tip} onChange={setTip} />
              </div>
              <div className="bg-brand-muted rounded-xl p-4 text-right">
                <span className="text-muted-foreground">Total: </span>
                <span className="font-black text-xl text-brand">${total.toFixed(2)}</span>
              </div>
              <Button onClick={handleCreateSession} disabled={saving || items.length === 0} className="w-full bg-brand hover:bg-brand/90 text-brand-foreground font-bold rounded-xl h-12 text-base">
                {saving ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" aria-hidden="true" /> Creating session...</> : "🔗 Generate QR Code →"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
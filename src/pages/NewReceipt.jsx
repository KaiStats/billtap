import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Upload, Loader2, Wand2, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export default function NewReceipt() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1: upload, 2: review/fix items
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

    navigate(createPageUrl(`SessionHost?id=${session.id}`));
  };

  const subtotal = items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
  const total = subtotal + (tax || 0) + (tip || 0);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-black text-gray-900">New Split</h2>
          <div className="flex gap-3 mt-3">
            {["📸 Photo", "✏️ Review"].map((s, i) => (
              <div key={s} className={`flex items-center gap-1 text-sm font-semibold ${step === i + 1 ? "text-purple-600" : step > i + 1 ? "text-green-600" : "text-gray-400"}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === i + 1 ? "bg-purple-600 text-white" : step > i + 1 ? "bg-green-600 text-white" : "bg-gray-200 text-gray-500"}`}>{i + 1}</div>
                {s}
                {i < 1 && <span className="text-gray-300 ml-1">›</span>}
              </div>
            ))}
          </div>
        </div>

        {step === 1 && (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-purple-200 rounded-2xl p-10 text-center cursor-pointer hover:border-purple-400 transition-colors bg-purple-50"
                onClick={() => document.getElementById("file-input").click()}
              >
                {imageUrl ? (
                  <img src={imageUrl} alt="Receipt" className="max-h-64 mx-auto rounded-xl object-contain" />
                ) : (
                  <>
                    <Upload className="w-12 h-12 mx-auto text-purple-300 mb-3" />
                    <p className="text-gray-600 font-medium">Drop receipt photo here or click to upload</p>
                    <p className="text-gray-400 text-sm mt-1">JPG, PNG, HEIC supported</p>
                  </>
                )}
              </div>
              <input id="file-input" type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              <Button
                onClick={handleParseReceipt}
                disabled={!imageFile || uploading || parsing}
                className="w-full bg-purple-600 hover:bg-purple-700 font-bold rounded-xl h-12 text-base"
              >
                {uploading ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" /> Uploading...</> :
                  parsing ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" /> AI is reading your receipt...</> :
                    <><Wand2 className="mr-2 w-4 h-4" /> Parse Receipt with AI</>}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-green-700 font-semibold text-sm flex items-center gap-2">
                ✅ Found {items.length} items — fix anything that looks wrong
              </div>
              <div>
                <Label>Bill title</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1 rounded-xl" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Line Items</Label>
                  <Button size="sm" variant="outline" onClick={addItem} className="rounded-lg text-xs">
                    <Plus className="w-3 h-3 mr-1" /> Add
                  </Button>
                </div>
                {items.map((item, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input value={item.name} onChange={e => updateItem(i, "name", e.target.value)} placeholder="Item name" className="flex-1 rounded-xl text-sm" />
                    <Input type="number" value={item.price} onChange={e => updateItem(i, "price", parseFloat(e.target.value) || 0)} className="w-24 rounded-xl text-sm" placeholder="Price" />
                    <button onClick={() => removeItem(i)} className="text-gray-400 hover:text-red-500"><X className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <Label>Tax</Label>
                  <Input type="number" value={tax} onChange={e => setTax(parseFloat(e.target.value) || 0)} className="mt-1 rounded-xl" />
                </div>
                <div className="flex-1">
                  <Label>Tip</Label>
                  <Input type="number" value={tip} onChange={e => setTip(parseFloat(e.target.value) || 0)} className="mt-1 rounded-xl" />
                </div>
              </div>
              <div className="bg-purple-50 rounded-xl p-4 text-right">
                <span className="text-gray-600">Total: </span>
                <span className="font-black text-xl text-purple-700">${total.toFixed(2)}</span>
              </div>
              <Button onClick={handleCreateSession} disabled={saving || items.length === 0} className="w-full bg-purple-600 hover:bg-purple-700 font-bold rounded-xl h-12 text-base">
                {saving ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" /> Creating session...</> : "🔗 Generate QR Code →"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
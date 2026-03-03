import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Upload, Loader2, Wand2, ArrowRight, X, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

// Calculate how much each participant owes based on item assignments
function calcAmounts(items, participants, tax, tip) {
  const subtotal = items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
  const total = subtotal + (tax || 0) + (tip || 0);
  const taxTipRatio = subtotal > 0 ? (total / subtotal) : 1;

  const amounts = {};
  participants.forEach(p => { amounts[p.name] = 0; });

  items.forEach(item => {
    const assigned = (item.assigned_to || []).filter(n => n);
    if (assigned.length === 0) return;
    const itemTotal = item.price * (item.quantity || 1);
    const share = (itemTotal * taxTipRatio) / assigned.length;
    assigned.forEach(name => {
      if (amounts[name] !== undefined) amounts[name] += share;
    });
  });

  return amounts;
}

export default function NewReceipt() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1: upload, 2: review items, 3: add people, 4: assign items
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [title, setTitle] = useState("");
  const [items, setItems] = useState([]);
  const [tax, setTax] = useState(0);
  const [tip, setTip] = useState(0);
  const [participants, setParticipants] = useState([{ name: "", email: "" }]);
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
      prompt: `Analyze this receipt image and extract all line items with their prices. Also extract the subtotal, tax, tip, and total if present. 
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
    setItems((result.items || []).map(item => ({ ...item, assigned_to: [] })));
    setTax(result.tax || 0);
    setTip(result.tip || 0);
    setParsing(false);
    setImageUrl(file_url);
    setStep(2);
  };

  const updateItem = (i, field, value) => setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const addItem = () => setItems(prev => [...prev, { name: "", price: 0, quantity: 1, assigned_to: [] }]);

  const addParticipant = () => setParticipants(prev => [...prev, { name: "", email: "" }]);
  const removeParticipant = (i) => setParticipants(prev => prev.filter((_, idx) => idx !== i));
  const updateParticipant = (i, field, value) => setParticipants(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p));

  // Toggle a participant on/off for an item
  const toggleAssignment = (itemIdx, personName) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== itemIdx) return item;
      const assigned = item.assigned_to || [];
      const already = assigned.includes(personName);
      return { ...item, assigned_to: already ? assigned.filter(n => n !== personName) : [...assigned, personName] };
    }));
  };

  // Assign all valid participants to an item
  const assignAll = (itemIdx) => {
    const names = participants.filter(p => p.name.trim()).map(p => p.name);
    setItems(prev => prev.map((item, i) => i === itemIdx ? { ...item, assigned_to: names } : item));
  };

  const handleSave = async () => {
    setSaving(true);
    const subtotal = items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
    const total = subtotal + (tax || 0) + (tip || 0);
    const validParticipants = participants.filter(p => p.name.trim());
    const amounts = calcAmounts(items, validParticipants, tax, tip);

    const receipt = await base44.entities.Receipt.create({
      title,
      image_url: imageUrl,
      total_amount: total,
      tax,
      tip,
      status: "assigned",
      items,
      participants: validParticipants.map(p => ({
        ...p,
        amount_owed: Math.round((amounts[p.name] || 0) * 100) / 100,
        payment_status: "unpaid"
      }))
    });

    navigate(createPageUrl(`ReceiptDetail?id=${receipt.id}`));
  };

  const subtotal = items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
  const total = subtotal + (tax || 0) + (tip || 0);
  const validParticipants = participants.filter(p => p.name.trim());
  const amounts = calcAmounts(items, validParticipants, tax, tip);

  const stepLabels = ["Upload", "Review Items", "Add People", "Assign Items"];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-black text-gray-900">New Split</h2>
          <div className="flex gap-3 mt-3 flex-wrap">
            {stepLabels.map((s, i) => (
              <div key={s} className={`flex items-center gap-1 text-sm font-semibold ${step === i + 1 ? "text-purple-600" : step > i + 1 ? "text-green-600" : "text-gray-400"}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === i + 1 ? "bg-purple-600 text-white" : step > i + 1 ? "bg-green-600 text-white" : "bg-gray-200 text-gray-500"}`}>
                  {i + 1}
                </div>
                {s}
                {i < 3 && <span className="text-gray-300 ml-1">›</span>}
              </div>
            ))}
          </div>
        </div>

        {/* STEP 1: Upload */}
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

        {/* STEP 2: Review Items */}
        {step === 2 && (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-6 space-y-4">
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
              <Button onClick={() => setStep(3)} className="w-full bg-purple-600 hover:bg-purple-700 font-bold rounded-xl h-12">
                Next: Add People <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* STEP 3: Add People */}
        {step === 3 && (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <Label className="text-base font-bold">Who's splitting this bill?</Label>
              {participants.map((p, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input value={p.name} onChange={e => updateParticipant(i, "name", e.target.value)} placeholder="Name" className="flex-1 rounded-xl text-sm" />
                  <Input type="email" value={p.email} onChange={e => updateParticipant(i, "email", e.target.value)} placeholder="Email (optional)" className="flex-1 rounded-xl text-sm" />
                  {participants.length > 1 && (
                    <button onClick={() => removeParticipant(i)} className="text-gray-400 hover:text-red-500"><X className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
              <Button variant="outline" onClick={addParticipant} className="w-full rounded-xl border-dashed">
                <Plus className="mr-2 w-4 h-4" /> Add Person
              </Button>
              <Button
                onClick={() => setStep(4)}
                disabled={validParticipants.length === 0}
                className="w-full bg-purple-600 hover:bg-purple-700 font-bold rounded-xl h-12"
              >
                Next: Assign Items <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* STEP 4: Assign Items */}
        {step === 4 && (
          <div className="space-y-4">
            <Card className="rounded-2xl border-0 shadow-sm">
              <CardContent className="p-5 space-y-4">
                <p className="text-sm text-gray-500">Tap names to assign each item. Items split between multiple people divide the cost equally.</p>
                {items.map((item, itemIdx) => {
                  const itemTotal = item.price * (item.quantity || 1);
                  return (
                    <div key={itemIdx} className="bg-gray-50 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-gray-900">{item.name}</div>
                          <div className="text-purple-700 font-bold text-sm">${itemTotal.toFixed(2)}{item.quantity > 1 ? ` (${item.quantity}×$${item.price.toFixed(2)})` : ""}</div>
                        </div>
                        <button
                          onClick={() => assignAll(itemIdx)}
                          className="text-xs text-purple-600 hover:underline font-medium"
                        >
                          All
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {validParticipants.map(p => {
                          const assigned = (item.assigned_to || []).includes(p.name);
                          return (
                            <button
                              key={p.name}
                              onClick={() => toggleAssignment(itemIdx, p.name)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                                assigned
                                  ? "bg-purple-600 text-white border-purple-600"
                                  : "bg-white text-gray-600 border-gray-200 hover:border-purple-300"
                              }`}
                            >
                              {assigned && <Check className="w-3 h-3" />}
                              {p.name}
                              {assigned && (item.assigned_to || []).length > 1 && (
                                <span className="opacity-70 text-xs">÷{(item.assigned_to || []).length}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Summary */}
            <Card className="rounded-2xl border-0 shadow-sm">
              <CardContent className="p-5 space-y-2">
                <div className="font-bold text-gray-900 mb-3">Summary</div>
                {validParticipants.map(p => (
                  <div key={p.name} className="flex justify-between text-sm">
                    <span className="text-gray-700">{p.name}</span>
                    <span className="font-bold text-purple-700">${(amounts[p.name] || 0).toFixed(2)}</span>
                  </div>
                ))}
                <div className="border-t pt-2 flex justify-between text-sm font-bold text-gray-500">
                  <span>Total assigned</span>
                  <span>${Object.values(amounts).reduce((s, v) => s + v, 0).toFixed(2)} / ${total.toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>

            <Button onClick={handleSave} disabled={saving} className="w-full bg-purple-600 hover:bg-purple-700 font-bold rounded-xl h-12 text-base">
              {saving ? <><Loader2 className="mr-2 w-4 h-4 animate-spin" /> Saving...</> : "Create Split"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
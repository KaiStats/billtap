import { useState } from "react";
import { Input } from "@/components/ui/input";

const PRESETS = [
  { label: "15%", value: 0.15 },
  { label: "18%", value: 0.18 },
  { label: "20%", value: 0.20 },
  { label: "25%", value: 0.25 },
];

export default function TipSelector({ subtotal, tip, onChange }) {
  const [showCustom, setShowCustom] = useState(false);
  const [customVal, setCustomVal] = useState("");

  const selectedPreset = !showCustom
    ? PRESETS.find(p => Math.abs(p.value * subtotal - tip) < 0.01)?.value ?? null
    : null;

  const handlePreset = (pct) => {
    setShowCustom(false);
    setCustomVal("");
    onChange(Math.round(subtotal * pct * 100) / 100);
  };

  const handleCustomChange = (val) => {
    setCustomVal(val);
    onChange(parseFloat(val) || 0);
  };

  const tipPct = subtotal > 0 ? (tip / subtotal) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {PRESETS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => handlePreset(value)}
            aria-label={`Tip ${label}`}
            aria-pressed={selectedPreset === value}
            className={`min-h-[44px] rounded-xl border-2 font-bold text-sm transition-all ${
              selectedPreset === value
                ? "bg-brand border-brand text-brand-foreground"
                : "bg-surface-raised border-border text-foreground hover:border-brand/40"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        onClick={() => { setShowCustom(true); setCustomVal(tip > 0 ? tip.toFixed(2) : ""); }}
        aria-pressed={showCustom}
        className={`w-full min-h-[44px] rounded-xl border-2 font-semibold text-sm transition-all ${
          showCustom
            ? "bg-brand-muted border-brand text-brand-muted-foreground"
            : "bg-surface-raised border-border text-muted-foreground hover:border-brand/40"
        }`}
      >
        Custom Amount
      </button>

      {showCustom && (
        <Input
          type="number"
          inputMode="decimal"
          placeholder="0.00"
          value={customVal}
          onChange={e => handleCustomChange(e.target.value)}
          aria-label="Custom tip amount in dollars"
          className="rounded-xl text-center font-bold text-lg"
          autoFocus
        />
      )}

      {tip > 0 && (
        <div className="bg-surface rounded-xl p-3 text-center">
          <span className="font-black text-lg text-foreground">${tip.toFixed(2)}</span>
          {subtotal > 0 && (
            <span className="text-muted-foreground text-sm ml-2">({tipPct.toFixed(1)}% of ${subtotal.toFixed(2)})</span>
          )}
        </div>
      )}
    </div>
  );
}
import { useState } from "react";
import { Input } from "@/components/ui/input";

const PRESETS = [
  { label: "None", value: 0 },
  { label: "15%", value: 0.15 },
  { label: "18%", value: 0.18 },
  { label: "20%", value: 0.20 },
  { label: "25%", value: 0.25 },
];

/**
 * Five buttons and a link.
 *
 * This used to end with a panel restating the tip in dollars and as a
 * percentage of the subtotal — directly above the receipt's own Tip line,
 * which says the same thing. The chosen button is already highlighted, so the
 * panel was a third copy of an answer the diner had just given.
 */
export default function TipSelector({ subtotal, tip, onChange }) {
  const [showCustom, setShowCustom] = useState(false);
  const [customVal, setCustomVal] = useState("");

  const selectedPreset = !showCustom
    ? PRESETS.find(p => Math.abs(p.value * subtotal - tip) < 0.01)?.value ?? null
    : null;

  const handlePreset = (pct) => {
    if (window.navigator.vibrate) window.navigator.vibrate(10);
    setShowCustom(false);
    setCustomVal("");
    onChange(Math.round(subtotal * pct * 100) / 100);
  };

  const handleCustomChange = (val) => {
    setCustomVal(val);
    onChange(parseFloat(val) || 0);
  };

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Tip amount</legend>
      <div className="grid grid-cols-5 gap-1.5">
        {PRESETS.map(({ label, value }) => (
          <button
            key={value}
            type="button"
            onClick={() => handlePreset(value)}
            aria-label={label === "None" ? "No tip" : `Tip ${label}`}
            aria-pressed={selectedPreset === value}
            className={`min-h-[48px] rounded-xl border-2 font-bold text-sm transition-all ${
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
        type="button"
        onClick={() => { setShowCustom(true); setCustomVal(tip > 0 ? tip.toFixed(2) : ""); }}
        aria-pressed={showCustom}
        className={`text-sm underline underline-offset-2 min-h-[44px] ${
          showCustom ? "text-brand font-semibold" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Type a different amount
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
    </fieldset>
  );
}

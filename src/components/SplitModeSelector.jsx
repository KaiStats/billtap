import { useState } from "react";

const MODES = [
  { 
    id: "itemized", 
    label: "Itemized", 
    icon: "🍽️", 
    description: "Each person claims their own items" 
  },
  { 
    id: "even", 
    label: "Even Split", 
    icon: "⚖️", 
    description: "Split equally among all participants" 
  },
  { 
    id: "custom", 
    label: "Custom", 
    icon: "📊", 
    description: "Set percentages or fixed amounts" 
  },
];

export default function SplitModeSelector({ value, onChange }) {
  const selectedMode = MODES.find(m => m.id === value);

  return (
    <div className="space-y-3">
      <label className="text-sm text-muted-foreground font-medium">Split Method</label>
      
      {/* Mode Cards */}
      <div className="grid grid-cols-1 gap-2">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            onClick={() => onChange(mode.id)}
            className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
              value === mode.id
                ? "border-brand bg-brand/5"
                : "border-white/10 bg-white/5 hover:border-brand/30"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="text-2xl">{mode.icon}</div>
              <div className="flex-1">
                <div className="font-bold text-foreground text-sm">{mode.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{mode.description}</div>
              </div>
              {value === mode.id && (
                <div className="w-6 h-6 rounded-full bg-brand flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Info Box */}
      {selectedMode && (
        <div className={`rounded-lg p-3 text-xs ${
          value === "itemized" ? "bg-blue-500/10 text-blue-300 border border-blue-500/20" :
          value === "even" ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20" :
          "bg-purple-500/10 text-purple-300 border border-purple-500/20"
        }`}>
          {selectedMode.id === "itemized" && "👆 Guests will tap items they ordered. Tax & tip are split proportionally."}
          {selectedMode.id === "even" && "🔢 Total bill divided equally. Each guest sees their flat share when they join."}
          {selectedMode.id === "custom" && "📊 Set custom percentages or amounts for each participant."}
        </div>
      )}
    </div>
  );
}
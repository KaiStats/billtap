import { Check } from "lucide-react";

/**
 * Three ways to divide a bill, described the way a diner would say them.
 *
 * The labels used to be the internal names — "Itemized", "Even Split",
 * "Custom" — with a description underneath each and a fourth coloured box
 * below repeating the description of whichever one was selected. That is four
 * blocks of prose to answer a question most people answer in a second.
 *
 * Now the label *is* the sentence, and only the chosen option explains itself.
 */
const MODES = [
  {
    id: "itemized",
    icon: "🍽️",
    label: "Everyone picks what they ate",
    hint: "Tax and tip get split fairly, based on what each person had.",
  },
  {
    id: "even",
    icon: "⚖️",
    label: "Split it evenly",
    hint: "Everyone pays the same amount.",
  },
  {
    id: "custom",
    icon: "✏️",
    label: "I'll decide who pays what",
    hint: "Share the code first, then set each person's amount.",
  },
];

export default function SplitModeSelector({ value, onChange }) {
  return (
    <div className="space-y-2">
      <h3 className="font-bold text-foreground">How should we split it?</h3>
      {MODES.map((mode) => {
        const selected = value === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => onChange(mode.id)}
            aria-pressed={selected}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 text-left transition-all active:scale-[0.99] ${
              selected
                ? "border-brand bg-brand/10"
                : "border-white/10 bg-white/[0.03] hover:border-brand/30"
            }`}
          >
            <span className="text-xl leading-none" aria-hidden="true">{mode.icon}</span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold text-sm text-foreground">{mode.label}</span>
              {selected && (
                <span className="block text-xs text-muted-foreground mt-0.5">{mode.hint}</span>
              )}
            </span>
            {selected && (
              <span className="w-6 h-6 rounded-full bg-brand flex items-center justify-center shrink-0">
                <Check className="w-4 h-4 text-brand-foreground" aria-hidden="true" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

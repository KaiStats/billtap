import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";

const SUB_MODES = [
  { id: "percentage", label: "Percentage", icon: "%", description: "Assign % to each person" },
  { id: "fixed", label: "Fixed Amount", icon: "$", description: "Set exact dollar amounts" },
  { id: "shares", label: "Shares", icon: "⊘", description: "Divide by shares" },
];

export default function CustomSplitConfig({ participants, totalAmount, onChange }) {
  const [subMode, setSubMode] = useState("percentage");
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const [isValid, setIsValid] = useState(false);

  // Initialize values when participants change
  useEffect(() => {
    const initialValues = {};
    participants.forEach(p => {
      if (subMode === "percentage") {
        initialValues[p.participant_id] = participants.length > 0 ? Math.round(100 / participants.length * 100) / 100 : 0;
      } else if (subMode === "fixed") {
        initialValues[p.participant_id] = participants.length > 0 ? Math.round((totalAmount / participants.length) * 100) / 100 : 0;
      } else if (subMode === "shares") {
        initialValues[p.participant_id] = 1;
      }
    });
    setValues(initialValues);
  }, [participants, subMode, totalAmount]);

  // Validate and calculate final amounts
  useEffect(() => {
    if (participants.length === 0) {
      setError("No participants yet. Guests need to join first.");
      setIsValid(false);
      onChange({ subMode, isValid: false, finalAmounts: {} });
      return;
    }

    let calculatedError = null;
    let calculatedAmounts = {};
    let valid = false;

    if (subMode === "percentage") {
      const totalPercentage = Object.values(values).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
      const diff = Math.abs(totalPercentage - 100);
      
      if (diff > 0.01) {
        calculatedError = `Percentages must add up to 100% (currently ${totalPercentage.toFixed(1)}%)`;
      } else {
        valid = true;
        // Calculate dollar amounts from percentages
        participants.forEach(p => {
          const percentage = parseFloat(values[p.participant_id]) || 0;
          calculatedAmounts[p.participant_id] = Math.round((totalAmount * percentage / 100) * 100) / 100;
        });
      }
    } else if (subMode === "fixed") {
      const totalFixed = Object.values(values).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
      const diff = Math.abs(totalFixed - totalAmount);
      
      if (diff > 0.01) {
        calculatedError = `Amounts must total $${totalAmount.toFixed(2)} (currently $${totalFixed.toFixed(2)})`;
      } else {
        valid = true;
        calculatedAmounts = { ...values };
      }
    } else if (subMode === "shares") {
      const totalShares = Object.values(values).reduce((sum, val) => sum + (parseInt(val) || 0), 0);
      
      if (totalShares === 0) {
        calculatedError = "Total shares must be greater than 0";
      } else {
        valid = true;
        // Calculate amounts based on shares
        const perShareValue = totalAmount / totalShares;
        participants.forEach(p => {
          const shares = parseInt(values[p.participant_id]) || 0;
          calculatedAmounts[p.participant_id] = Math.round((perShareValue * shares) * 100) / 100;
        });
      }
    }

    setError(calculatedError);
    setIsValid(valid);
    /**
     * `calculatedAmounts` is handed straight to the parent and not stored.
     *
     * It used to also go into a `finalAmounts` state that nothing ever read --
     * so every recalculation, which is every keystroke in this form, queued a
     * re-render whose only effect was to run the same arithmetic again.
     */
    onChange({ subMode, isValid: valid, finalAmounts: calculatedAmounts });
  }, [subMode, values, participants, totalAmount, onChange]);

  const handleValueChange = (participantId, newValue) => {
    setValues(prev => ({
      ...prev,
      [participantId]: newValue,
    }));
  };

  const remainingBalance = subMode === "fixed" 
    ? totalAmount - Object.values(values).reduce((sum, val) => sum + (parseFloat(val) || 0), 0)
    : null;

  return (
    <div className="space-y-4">
      {/* Sub-mode Selector */}
      <div className="grid grid-cols-3 gap-2">
        {SUB_MODES.map((mode) => (
          <button
            key={mode.id}
            onClick={() => setSubMode(mode.id)}
            className={`p-3 rounded-xl border-2 transition-all text-center ${
              subMode === mode.id
                ? "border-brand bg-brand/5"
                : "border-white/10 bg-white/5 hover:border-brand/30"
            }`}
          >
            <div className="text-lg font-bold mb-1">{mode.icon}</div>
            <div className="text-xs font-semibold">{mode.label}</div>
          </button>
        ))}
      </div>

      {/* Error Message */}
      {error && (
        <div className={`rounded-xl p-3 flex items-start gap-2 text-sm ${
          isValid 
            ? "bg-info-muted border border-info/30 text-info-muted-foreground"
            : "bg-danger-muted border border-destructive/30 text-danger-muted-foreground"
        }`}>
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="font-medium">{error}</p>
        </div>
      )}

      {/* Participant List */}
      <div className="space-y-3">
        {participants.map((participant) => (
          <div
            key={participant.participant_id}
            className="rounded-xl p-3"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold">{participant.name || "Unnamed"}</Label>
              {subMode !== "shares" && (
                <span className="text-lg font-black text-brand">
                  ${subMode === "percentage" 
                    ? (Math.round((totalAmount * ((parseFloat(values[participant.participant_id]) || 0) / 100)) * 100) / 100).toFixed(2)
                    : (parseFloat(values[participant.participant_id]) || 0).toFixed(2)
                  }
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              {subMode === "percentage" && (
                <>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={values[participant.participant_id] || ""}
                    onChange={(e) => handleValueChange(participant.participant_id, e.target.value)}
                    placeholder="0"
                    className="flex-1 rounded-xl text-sm"
                    aria-label={`${participant.name}'s percentage`}
                  />
                  <span className="text-lg font-bold text-muted-foreground">%</span>
                </>
              )}
              
              {subMode === "fixed" && (
                <>
                  <span className="text-lg font-bold text-muted-foreground">$</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={values[participant.participant_id] || ""}
                    onChange={(e) => handleValueChange(participant.participant_id, e.target.value)}
                    placeholder="0.00"
                    className="flex-1 rounded-xl text-sm"
                    aria-label={`${participant.name}'s amount`}
                  />
                </>
              )}
              
              {subMode === "shares" && (
                <>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={values[participant.participant_id] || ""}
                    onChange={(e) => handleValueChange(participant.participant_id, parseInt(e.target.value) || 0)}
                    placeholder="1"
                    className="flex-1 rounded-xl text-sm"
                    aria-label={`${participant.name}'s shares`}
                  />
                  <span className="text-sm font-bold text-muted-foreground">share(s)</span>
                  <span className="text-sm text-muted-foreground ml-2">
                    = ${(Math.round((totalAmount / Object.values(values).reduce((sum, val) => sum + (parseInt(val) || 0), 0)) * ((parseInt(values[participant.participant_id]) || 1)) * 100) / 100).toFixed(2)}
                  </span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Remaining Balance for Fixed Mode */}
      {subMode === "fixed" && remainingBalance !== null && (
        <div className={`rounded-xl p-3 text-center ${
          Math.abs(remainingBalance) < 0.01
            ? "bg-success-muted border border-success/30 text-success-muted-foreground"
            : remainingBalance > 0
            ? "bg-warning-muted border border-warning/30 text-warning-muted-foreground"
            : "bg-danger-muted border border-destructive/30 text-danger-muted-foreground"
        }`}>
          <p className="text-sm font-medium">
            {Math.abs(remainingBalance) < 0.01
              ? "✓ Perfect! Amounts total exactly"
              : remainingBalance > 0
              ? `$${remainingBalance.toFixed(2)} remaining to assign`
              : `$${Math.abs(remainingBalance).toFixed(2)} over total`
            }
          </p>
        </div>
      )}

      {/* Summary for Shares Mode */}
      {subMode === "shares" && (
        <div className="rounded-xl p-3 bg-info-muted border border-info/30 text-info-muted-foreground text-center">
          <p className="text-sm font-medium">
            Total: {Object.values(values).reduce((sum, val) => sum + (parseInt(val) || 0), 0)} share(s)
            {totalAmount > 0 && Object.values(values).reduce((sum, val) => sum + (parseInt(val) || 0), 0) > 0 && (
              <span className="ml-2">
                • ${(totalAmount / Object.values(values).reduce((sum, val) => sum + (parseInt(val) || 0), 0)).toFixed(2)} per share
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
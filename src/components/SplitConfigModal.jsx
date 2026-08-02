import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import CustomSplitConfig from "@/components/CustomSplitConfig";
import { Settings } from "lucide-react";
import ErrorNotice from "@/components/ErrorNotice";

export default function SplitConfigModal({ session, onClose, onUpdate }) {
  const [subMode, setSubMode] = useState(
    session.custom_split_config?.type || "percentage"
  );
  const [values, setValues] = useState({});
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  // Initialize values from existing config
  useEffect(() => {
    if (session.participants && session.custom_split_config) {
      const initialValues = {};
      session.participants.forEach(p => {
        if (subMode === "percentage") {
          const total = session.total_amount || 0;
          const amount = p.amount_owed || 0;
          initialValues[p.participant_id] = total > 0 ? Math.round((amount / total * 100) * 100) / 100 : 0;
        } else if (subMode === "fixed") {
          initialValues[p.participant_id] = p.amount_owed || 0;
        } else if (subMode === "shares") {
          // Can't reverse-engineer shares, default to 1
          initialValues[p.participant_id] = 1;
        }
      });
      setValues(initialValues);
    }
  }, [session.participants, session.custom_split_config, subMode, session.total_amount]);

  const handleSave = async () => {
    if (!config?.isValid) return;
    
    setSaving(true);
    try {
      const updatedParticipants = session.participants.map(p => ({
        ...p,
        amount_owed: config.finalAmounts[p.participant_id] || 0,
      }));

      await base44.entities.Session.update(session.id, {
        split_mode: "custom",
        custom_split_config: {
          type: subMode,
          values: config.finalAmounts,
        },
        participants: updatedParticipants,
      });

      onUpdate({
        ...session,
        split_mode: "custom",
        custom_split_config: {
          type: subMode,
          values: config.finalAmounts,
        },
        participants: updatedParticipants,
      });
      onClose();
    } catch (err) {
      console.error("Failed to save split config:", err);
      setFailure(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <Card className="w-full max-w-lg rounded-2xl my-8" onClick={e => e.stopPropagation()}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Configure Custom Split
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/*
            Inside the modal rather than over it. The host has just typed a set
            of amounts; a dialog on top of a dialog would hide the numbers they
            need in order to fix anything.
          */}
          <ErrorNotice error={failure} onDismiss={() => setFailure(null)} />

          <div className="rounded-lg p-3 bg-info-muted border border-info/30 text-info-muted-foreground text-sm">
            <p className="font-medium">💡 Split Mode: {subMode === "percentage" ? "Percentage" : subMode === "fixed" ? "Fixed Amount" : "Shares"}</p>
            <p className="text-xs mt-1 opacity-80">
              {subMode === "percentage" ? "Assign percentages that add up to 100%" :
               subMode === "fixed" ? "Set exact dollar amounts for each person" :
               "Divide the bill by shares (e.g., 2 shares = 2x the amount)"}
            </p>
          </div>

          <CustomSplitConfig
            participants={session.participants || []}
            totalAmount={session.total_amount || 0}
            onChange={setConfig}
          />

          <div className="flex gap-2 pt-4 border-t border-white/10">
            <Button variant="outline" onClick={onClose} className="flex-1" disabled={saving}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              className="flex-1 bg-brand hover:bg-brand/90"
              disabled={!config?.isValid || saving}
            >
              {saving ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
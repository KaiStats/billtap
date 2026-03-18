import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { useTabNav } from "@/lib/TabNavigationContext";
import { createPageUrl } from "@/utils";
import { CheckCircle2, Clock, Users, Receipt, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AppHeader from "@/components/AppHeader";
import { dispatchMutationError } from "@/components/MutationErrorToast";

const statusColors = {
  unpaid: "bg-danger-muted text-danger-muted-foreground",
  pending: "bg-warning-muted text-warning-muted-foreground",
  paid: "bg-success-muted text-success-muted-foreground",
};

export default function ReceiptDetail() {
  const { pushScreen } = useTabNav();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const sessionId = new URLSearchParams(window.location.search).get("id");
  const isHost = new URLSearchParams(window.location.search).get("host") === "1";

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    const data = await base44.entities.Session.filter({ id: sessionId });
    setSession(data[0] || null);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { fetchSession(); }, [fetchSession]);

  useEffect(() => {
    if (!sessionId) return;
    const unsub = base44.entities.Session.subscribe((event) => {
      if (event.id === sessionId && event.data) setSession(event.data);
    });
    return unsub;
  }, [sessionId]);

  const markPaidMutation = useMutation({
    mutationFn: ({ updatedParticipants, newStatus }) =>
      base44.entities.Session.update(session.id, { participants: updatedParticipants, status: newStatus }),
    onMutate: ({ updatedParticipants, newStatus }) => {
      const snapshot = session;
      setSession(prev => ({ ...prev, participants: updatedParticipants, status: newStatus }));
      return snapshot;
    },
    onError: (err, _vars, snapshot) => { setSession(snapshot); dispatchMutationError(err); },
    onSuccess: (updated) => { setSession(updated); },
  });

  const markAsPaid = (participantId) => {
    const updatedParticipants = session.participants.map(p =>
      p.participant_id === participantId ? { ...p, payment_status: "paid" } : p
    );
    const allPaid = updatedParticipants.every(p => p.payment_status === "paid");
    markPaidMutation.mutate({ updatedParticipants, newStatus: allPaid ? "completed" : "claiming" });
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" aria-hidden="true" />
        <span>Loading…</span>
      </div>
    </div>
  );
  if (!session) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Session not found.</div>;

  const participants = session.participants || [];
  const items = session.items || [];
  const paid = participants.filter(p => p.payment_status === "paid").length;
  const total = participants.length;
  const claimedCount = items.filter(i => (i.claimed_by || []).length > 0).length;

  const getName = (pid) => {
    const p = participants.find(x => x.participant_id === pid);
    return p ? p.name : "?";
  };

  const rightAction = isHost ? (
    <button
      onClick={() => pushScreen(createPageUrl(`SessionHost?id=${sessionId}`))}
      className="w-11 h-11 flex items-center justify-center rounded-xl text-brand active:bg-brand-muted"
      aria-label="Show QR"
    >
      <QrCode className="w-5 h-5" aria-hidden="true" />
    </button>
  ) : null;

  return (
    <div className="min-h-screen bg-surface">
      <AppHeader title={session.title} backTo={createPageUrl("Dashboard")} rightAction={rightAction} />
      <div className="max-w-2xl mx-auto p-5 space-y-5 pb-safe-or-5" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mt-0 text-muted-foreground text-sm flex-wrap">
              <span className="flex items-center gap-1"><Users className="w-4 h-4" aria-hidden="true" /> {total} people</span>
              <span className="flex items-center gap-1"><Receipt className="w-4 h-4" aria-hidden="true" /> ${(session.total_amount || 0).toFixed(2)} total</span>
              <span className="font-semibold text-success">{paid}/{total} paid</span>
              <span className="text-muted-foreground">{claimedCount}/{items.length} items claimed</span>
            </div>
          </div>
          <div>
            <Badge className={session.status === "completed" ? "bg-success-muted text-success-muted-foreground" : "bg-info-muted text-info-muted-foreground"}>
              {session.status}
            </Badge>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Items claimed</span><span>{claimedCount}/{items.length}</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={claimedCount}
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-label="Items claimed"
            className="w-full bg-muted rounded-full h-2"
          >
            <div className="bg-brand h-2 rounded-full transition-all" style={{ width: `${items.length > 0 ? (claimedCount / items.length) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Image */}
        {session.image_url && (
          <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
            <img src={session.image_url} alt="Receipt" className="w-full max-h-64 object-contain bg-muted" />
          </Card>
        )}

        {/* Items */}
        {items.length > 0 && (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardHeader className="pb-2 pt-5 px-5"><CardTitle className="text-base">Items</CardTitle></CardHeader>
            <CardContent className="px-5 pb-5 space-y-2">
              {items.map((item, i) => {
                const claimed = item.claimed_by || [];
                return (
                  <div key={i} className="flex justify-between text-sm items-center">
                    <div>
                      <span className="text-foreground">{item.quantity > 1 ? `${item.quantity}× ` : ""}{item.name}</span>
                      {claimed.length > 0 && (
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {claimed.map(pid => (
                            <span key={pid} className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">👤 {getName(pid)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="font-semibold text-foreground">${(item.price * (item.quantity || 1)).toFixed(2)}</span>
                  </div>
                );
              })}
              {session.tax > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground pt-1 border-t border-border">
                  <span>Tax</span><span>${session.tax.toFixed(2)}</span>
                </div>
              )}
              {session.tip > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Tip</span><span>${session.tip.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-base pt-2 border-t border-border">
                <span>Total</span><span className="text-brand">${(session.total_amount || 0).toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Participants */}
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardHeader className="pb-2 pt-5 px-5"><CardTitle className="text-base">Who owes what</CardTitle></CardHeader>
          <CardContent className="px-5 pb-5 space-y-3">
            {participants.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-3">No one has joined yet. Share the QR code!</p>
            ) : participants.map((p) => (
              <div key={p.participant_id} className="flex items-center justify-between p-3 bg-surface rounded-xl">
                <div>
                  <div className="font-semibold text-foreground">{p.name}</div>
                  <div className="text-brand font-black text-lg mt-0.5">${(p.amount_owed || 0).toFixed(2)}</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge className={statusColors[p.payment_status] || statusColors.unpaid}>
                    {p.payment_status === "paid"
                      ? <><CheckCircle2 className="w-3 h-3 mr-1" aria-hidden="true" />{p.payment_status}</>
                      : <><Clock className="w-3 h-3 mr-1" aria-hidden="true" />{p.payment_status}</>
                    }
                  </Badge>
                  {p.payment_status !== "paid" && isHost && (
                    <Button size="sm" onClick={() => markAsPaid(p.participant_id)} className="h-11 text-sm px-4 bg-success hover:bg-success/90 text-success-muted-foreground rounded-xl">
                      Mark Paid
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
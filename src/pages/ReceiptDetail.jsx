import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useTabNav } from "@/lib/TabNavigationContext";
import { createPageUrl } from "@/utils";
import { CheckCircle2, Clock, Users, Receipt, QrCode, PartyPopper, Share2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AppHeader from "@/components/AppHeader";
import ReceiptDetailSkeleton from "@/components/ReceiptDetailSkeleton";
import { useMutationOptimistic } from "@/hooks/useMutationOptimistic";

const paymentStatusConfig = {
  unpaid:               { cls: "bg-danger-muted text-danger-muted-foreground" },
  pending_verification: { cls: "bg-warning-muted text-warning-muted-foreground" },
  paid:                 { cls: "bg-success-muted text-success-muted-foreground" },
};

export default function ReceiptDetail() {
  const { pushScreen } = useTabNav();
  const { toast } = useToast();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const sessionId = new URLSearchParams(window.location.search).get("id");
  const isHostParam = new URLSearchParams(window.location.search).get("host") === "1";
  if (isHostParam && sessionId) localStorage.setItem(`billtap-host-${sessionId}`, "true");
  const isHost = isHostParam || localStorage.getItem(`billtap-host-${sessionId}`) === "true";

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    const data  = await base44.entities.Session.list("-created_date", 200);
    const found = data.find(s => s.id === sessionId) || null;
    setSession(found);
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

  const markPaidMutation = useMutationOptimistic(
    ({ updatedParticipants, newStatus }) =>
      base44.entities.Session.update(session.id, { participants: updatedParticipants, status: newStatus }),
    {
      onOptimisticState: () => session,
      onRollback: (snapshot) => setSession(snapshot),
      onSuccess: (updated) => setSession(updated),
    }
  );

  const handleShareBillTap = async () => {
    const shareData = {
      title: "BillTap — Split bills the fair way",
      text: "Just split a restaurant bill with BillTap — everyone paid exactly what they ordered. Try it free:",
      url: "https://billtap.app",
    };
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard.writeText("https://billtap.app");
      toast({ description: "Link copied — share billtap.app with your friends" });
    }
  };

  const markAsPaid = (participantId) => {
    const updatedParticipants = session.participants.map(p =>
      p.participant_id === participantId ? { ...p, payment_status: "paid" } : p
    );
    const allPaid = updatedParticipants.every(p => p.payment_status === "paid");
    markPaidMutation.mutate({ updatedParticipants, newStatus: allPaid ? "completed" : "claiming" });
  };

  if (loading) return (
    <div className="min-h-screen bg-background">
      <AppHeader title="" />
      <ReceiptDetailSkeleton />
    </div>
  );
  if (!session) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Session not found.</div>;

  const participants  = session.participants || [];
  const items         = session.items || [];
  const paid          = participants.filter(p => p.payment_status === "paid").length;
  const total         = participants.length;
  const claimedCount  = items.filter(i => (i.claimed_by || []).length > 0).length;
  const allPaid       = participants.length > 0 && participants.every(p => p.payment_status === "paid");
  const paidPct       = total > 0 ? Math.round((paid / total) * 100) : 0;

  const getName = (pid) => {
    const p = participants.find(x => x.participant_id === pid);
    return p ? p.name : "?";
  };

  const rightAction = isHost ? (
    <button
      onClick={() => pushScreen(createPageUrl(`SessionHost?id=${sessionId}`))}
      className="w-11 h-11 flex items-center justify-center rounded-xl text-brand active:bg-brand-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      aria-label="Show QR code"
    >
      <QrCode className="w-5 h-5" aria-hidden="true" />
    </button>
  ) : null;

  return (
    <div className="min-h-screen bg-background pb-8">
      <AppHeader title={session.title || "Bill Details"} backTo={createPageUrl("Dashboard")} rightAction={rightAction} />

      {/* Hero Summary */}
      <div
        className="relative overflow-hidden px-5 pt-6 pb-6"
        style={{ background: 'linear-gradient(160deg, #0f0c29 0%, #1a1535 100%)' }}
      >
        <div className="absolute inset-0 pointer-events-none">
          <div style={{ position: 'absolute', top: '-30%', right: '-10%', width: '40vw', height: '40vw', maxWidth: 220, maxHeight: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(102,126,234,0.35) 0%, transparent 70%)', filter: 'blur(40px)' }} />
        </div>
        <div className="relative z-10 max-w-2xl mx-auto">
          {/* All Settled Banner */}
          {allPaid && (
            <div className="mb-4 space-y-3">
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)' }}>
                <PartyPopper className="w-5 h-5 text-emerald-400" aria-hidden="true" />
                <div>
                  <p className="font-bold text-emerald-400 text-sm">All Settled! 🎉</p>
                  <p className="text-xs text-emerald-400/70">Everyone has paid their share</p>
                </div>
              </div>
              <Button
                onClick={handleShareBillTap}
                variant="outline"
                className="w-full border-brand text-brand hover:bg-brand-muted rounded-2xl h-11 font-semibold"
              >
                <Share2 className="w-4 h-4 mr-2" aria-hidden="true" />
                Share BillTap with friends
              </Button>
            </div>
          )}

          <div className="flex items-start justify-between mb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3 text-white/60 text-sm flex-wrap">
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" aria-hidden="true" /> {total} people</span>
                <span className="flex items-center gap-1"><Receipt className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="text-white font-bold">${(session.total_amount || 0).toFixed(2)}</span>
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <span className="text-emerald-400 font-semibold">{paid}/{total} paid</span>
                <span className="text-white/40">{claimedCount}/{items.length} items claimed</span>
              </div>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${session.status === "completed" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-blue-500/20 text-blue-400 border border-blue-500/30"}`}>
              {session.status}
            </span>
          </div>

          {/* Payment progress bar */}
          <div>
            <div className="flex justify-between text-xs text-white/40 mb-1">
              <span>Payments received</span><span>{paidPct}%</span>
            </div>
            <div role="progressbar" aria-valuenow={paid} aria-valuemin={0} aria-valuemax={total} aria-label="Payments received" className="w-full bg-white/10 rounded-full h-2">
              <div className="h-2 rounded-full transition-all" style={{ width: `${paidPct}%`, background: 'linear-gradient(90deg, #667eea, #f093fb)' }} />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-5 space-y-4">

        {/* Receipt image */}
        {session.image_url && (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            <img src={session.image_url} alt={`Receipt for ${session.title}`} loading="lazy" decoding="async" className="w-full max-h-64 object-contain bg-muted" />
          </div>
        )}

        {/* Items */}
        {items.length > 0 && (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="px-5 pt-4 pb-2">
              <h2 className="text-lg font-semibold text-foreground">Items</h2>
            </div>
            <div className="px-5 pb-5 space-y-2">
              {items.map((item, i) => {
                const claimed = item.claimed_by || [];
                return (
                  <div key={i} className="flex justify-between text-sm items-start py-1">
                    <div>
                      <span className="text-foreground font-medium">{item.quantity > 1 ? `${item.quantity}× ` : ""}{item.name}</span>
                      {claimed.length > 0 && (
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {claimed.map(pid => (
                            <span key={pid} className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">👤 {getName(pid)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="font-semibold text-foreground shrink-0 ml-4">${(item.price * (item.quantity || 1)).toFixed(2)}</span>
                  </div>
                );
              })}
              {session.tax > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground pt-2 border-t border-border">
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
            </div>
          </div>
        )}

        {/* Participants */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="px-5 pt-4 pb-2">
            <h2 className="text-lg font-semibold text-foreground">Who owes what</h2>
          </div>
          <div className="px-5 pb-5 space-y-3">
            {participants.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">No one has joined yet. Share the QR code!</p>
            ) : participants.map((p) => (
              <div
                key={p.participant_id}
                className="flex items-center justify-between p-4 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div>
                  <div className="font-semibold text-foreground">{p.name}</div>
                  <div className="text-brand font-black text-xl mt-0.5">${(p.amount_owed || 0).toFixed(2)}</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge className={paymentStatusConfig[p.payment_status]?.cls || paymentStatusConfig.unpaid.cls}>
                    {p.payment_status === "paid"
                      ? <><CheckCircle2 className="w-3 h-3 mr-1" aria-hidden="true" />{p.payment_status}</>
                      : <><Clock className="w-3 h-3 mr-1" aria-hidden="true" />{p.payment_status}</>}
                  </Badge>
                  {p.payment_status !== "paid" && isHost && (
                    <Button
                      size="sm"
                      onClick={() => markAsPaid(p.participant_id)}
                      aria-label={`Mark ${p.name} as paid`}
                      className="h-9 text-xs px-4 bg-success hover:bg-success/90 text-white rounded-xl"
                    >
                      Mark Paid
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
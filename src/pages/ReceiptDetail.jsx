import { useState, useEffect, useCallback } from "react";
import { invoke } from "@/api/functions";
import { useNavigate } from "react-router";
import { CheckCircle2, Clock, Users, Receipt, QrCode, PartyPopper, Share2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AppHeader from "@/components/AppHeader";
import ReceiptDetailSkeleton from "@/components/ReceiptDetailSkeleton";
import { useMutationOptimistic } from "@/hooks/useMutationOptimistic";
import { getHostKey } from "@/lib/hostKey";
import { useLiveSplit } from "@/hooks/useLiveSplit";
import { sessionPath } from '@/lib/sessionLinks';

/**
 * What each state means to a person, rather than what it is called in the
 * database. "pending_verification" was rendered raw on this screen, which asks
 * a host to parse a schema enum while their friends wait for their food.
 */
const PAYMENT_STATE = {
  unpaid: {
    cls: "bg-danger-muted text-danger-muted-foreground",
    label: "Not paid yet",
  },
  pending_verification: {
    cls: "bg-warning-muted text-warning-muted-foreground",
    label: "Says they sent it",
  },
  paid: {
    cls: "bg-success-muted text-success-muted-foreground",
    label: "You confirmed it",
  },
};

export default function ReceiptDetail() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isHost, setIsHost] = useState(false);

  const sessionId = new URLSearchParams(window.location.search).get("id");

  /**
   * Load the split, and find out whether this device is the host while doing it.
   *
   * getSessionAsHost accepts either proof: the secret minted at creation, or a
   * signed-in owner. Both answer 403 if neither holds, and then we fall back to
   * the ordinary read that Base44's rules allow.
   *
   * The previous version asked `?host=1` in the URL. That is not authorization,
   * it is a suggestion — any diner could add it, see "Mark Paid" appear next to
   * everyone's name, and tap it. The write itself was refused by Base44's
   * update rule for an owned split, so nothing was actually forged; what they
   * got was a button that silently did nothing. For a table-tent split, which
   * has no owner at all, the same rule refused the *real* host too, so the one
   * person who needed the button was equally unable to use it.
   */
  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await invoke("getSessionAsHost", {
        session_id: sessionId,
        host_key: getHostKey(sessionId),
      });
      if (res.data?.session) {
        setSession(res.data.session);
        setIsHost(true);
        return;
      }
    } catch {
      // 403 is the ordinary answer for a diner opening their own receipt.
    }
    try {
      // No participant id, matching the live poll below: this screen does not
      // know which diner is looking, so it asks for the view that names nobody's
      // share. It used to be a direct entity read, which returned the raw row —
      // every amount and the host key hash — to whoever opened the link.
      const res = await invoke("getSplitStatus", { session_id: sessionId });
      setSession(res.data?.session || null);
    } catch {
      setSession(null);
    }
    setIsHost(false);
  }, [sessionId]);

  useEffect(() => { fetchSession().finally(() => setLoading(false)); }, [fetchSession]);

  // The host watching payments arrive. Only polls as the host when this device
  // holds the key; a diner reading their own receipt gets the scoped view.
  useLiveSplit(sessionId, {
    hostKey: isHost ? getHostKey(sessionId) : undefined,
    onUpdate: setSession,
  });

  /**
   * Confirming, and taking it back.
   *
   * Names one participant and lets the server patch that row against stored
   * data. It replaces a Session.update that sent the whole participants array
   * from the browser — the same shape of bug the audit found in joinSession,
   * where two saves at once meant one was silently erased and a crafted client
   * could rewrite every amount in the split.
   */
  const confirmMutation = useMutationOptimistic(
    async ({ participantId, action }) => {
      const res = await invoke("confirmPayment", {
        session_id: sessionId,
        participant_id: participantId,
        host_key: getHostKey(sessionId),
        action,
      });
      return res.data?.session;
    },
    {
      onOptimisticState: () => session,
      onRollback: (snapshot) => {
        setSession(snapshot);
        toast({ description: "Could not save that — check your connection and try again." });
      },
      onSuccess: (updated) => { if (updated) setSession(updated); },
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

  const confirmPaid = (participantId) => confirmMutation.mutate({ participantId, action: "confirm" });
  const undoPaid = (participantId) => confirmMutation.mutate({ participantId, action: "undo" });

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
  const awaiting      = participants.filter(p => p.payment_status === "pending_verification").length;
  const total         = participants.length;
  const claimedCount  = items.filter(i => (i.claimed_by || []).length > 0).length;
  const allPaid       = participants.length > 0 && participants.every(p => p.payment_status === "paid");
  const paidPct       = total > 0 ? Math.round((paid / total) * 100) : 0;

  // Money in versus money owed. The counts say how many people are settled;
  // this says whether the bill is. They can disagree — someone confirmed at $26
  // whose share later grew is one person "paid" and still short — and when they
  // do, the host should see it rather than a reassuring 5 of 5.
  const collected = participants.reduce(
    (sum, p) => sum + (p.payment_status === "paid" ? (p.paid_amount ?? p.amount_owed ?? 0) : 0), 0,
  );
  const billTotal = session.total_amount || 0;
  const shortfall = Math.round((billTotal - collected) * 100) / 100;

  const getName = (pid) => {
    const p = participants.find(x => x.participant_id === pid);
    return p ? p.name : "?";
  };

  const rightAction = isHost ? (
    <button
      onClick={() => navigate(sessionPath('/session-host', sessionId))}
      className="w-11 h-11 flex items-center justify-center rounded-xl text-brand active:bg-brand-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      aria-label="Show QR code"
    >
      <QrCode className="w-5 h-5" aria-hidden="true" />
    </button>
  ) : null;

  return (
    <div className="min-h-screen bg-background pb-8">
      <AppHeader title={session.title || "Bill Details"} backTo="/dashboard" rightAction={rightAction} />

      {/* Hero Summary */}
      <div
        className="relative overflow-hidden px-5 pt-6 pb-6"
        style={{ background: 'linear-gradient(165deg, #070b16 0%, #0d1728 100%)' }}
      >
        <div className="absolute inset-0 pointer-events-none">
          <div style={{ position: 'absolute', top: '-30%', right: '-10%', width: '40vw', height: '40vw', maxWidth: 220, maxHeight: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,200,150,0.35) 0%, transparent 70%)', filter: 'blur(40px)' }} />
        </div>
        <div className="relative z-10 max-w-2xl mx-auto">
          {/* All Settled Banner. Gated on the money adding up as well as the
              rows being ticked — a celebration over a short bill is worse than
              no celebration. */}
          {allPaid && shortfall <= 0.01 && (
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
                  <span className="mono text-white font-bold tabular-nums">${(session.total_amount || 0).toFixed(2)}</span>
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm flex-wrap">
                {/* "Confirmed", not "paid". The difference is the whole point of
                    this screen: a diner saying they sent money and the money
                    having arrived are two different facts, and only the second
                    one settles a bill. */}
                <span className="text-emerald-400 font-semibold">{paid}/{total} confirmed</span>
                {awaiting > 0 && (
                  <span className="text-amber-300 font-semibold">{awaiting} waiting on you</span>
                )}
                <span className="text-white/40">{claimedCount}/{items.length} items claimed</span>
              </div>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${session.status === "completed" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-blue-500/20 text-blue-400 border border-blue-500/30"}`}>
              {session.status}
            </span>
          </div>

          {/* Money in, against the bill. The counts above say how many people
              are settled; this says whether the bill is, which is the number
              the host is actually carrying. */}
          <div>
            <div className="flex justify-between text-xs text-white/40 mb-1">
              <span>
                <span className="mono text-white font-semibold tabular-nums">${collected.toFixed(2)}</span> of <span className="mono tabular-nums">${billTotal.toFixed(2)}</span> collected
              </span>
              <span>{paidPct}%</span>
            </div>
            <div role="progressbar" aria-valuenow={paid} aria-valuemin={0} aria-valuemax={total} aria-label={`${paid} of ${total} payments confirmed`} className="w-full bg-white/10 rounded-full h-2">
              <div className="h-2 rounded-full transition-all" style={{ width: `${paidPct}%`, background: 'linear-gradient(90deg, #00c896, #2ee6b0)' }} />
            </div>
            {/* Everyone ticked off and the bill still not covered. It happens
                when a diner claims more after being confirmed, and it is the
                one case where the tally would otherwise lie to the host. */}
            {isHost && allPaid && shortfall > 0.01 && (
              <p className="text-xs text-amber-300 mt-2">
                Everyone is confirmed, but ${shortfall.toFixed(2)} of the bill is still uncovered.
              </p>
            )}
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
                    <span className="mono font-semibold text-foreground shrink-0 ml-4 tabular-nums">${(item.price * (item.quantity || 1)).toFixed(2)}</span>
                  </div>
                );
              })}
              {session.tax > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground pt-2 border-t border-border">
                  <span>Tax</span><span className="mono tabular-nums">${session.tax.toFixed(2)}</span>
                </div>
              )}
              {session.tip > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Tip</span><span className="mono tabular-nums">${session.tip.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base pt-2 border-t border-border">
                <span>Total</span><span className="mono text-primary tabular-nums">${(session.total_amount || 0).toFixed(2)}</span>
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
            ) : participants.map((p) => {
              const state = PAYMENT_STATE[p.payment_status] || PAYMENT_STATE.unpaid;
              const settled = p.payment_status === "paid";
              // What they were confirmed for, against what they owe now. These
              // part company when someone claims more after being confirmed,
              // and the host is the only person who can put that right.
              const owes = p.amount_owed || 0;
              const drift = settled && p.paid_amount != null
                ? Math.round((owes - p.paid_amount) * 100) / 100
                : 0;

              return (
                <div
                  key={p.participant_id}
                  className="p-4 rounded-xl space-y-3"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground truncate">{p.name}</div>
                      <div className="mono text-primary font-semibold text-xl mt-0.5 tabular-nums">
                        ${(settled ? (p.paid_amount ?? owes) : owes).toFixed(2)}
                      </div>
                      {drift > 0 && (
                        <p className="text-xs text-warning-muted-foreground mt-1">
                          Claimed ${drift.toFixed(2)} more after paying — still owes it.
                        </p>
                      )}
                    </div>
                    <Badge className={state.cls}>
                      {settled
                        ? <><CheckCircle2 className="w-3 h-3 mr-1" aria-hidden="true" />{state.label}</>
                        : <><Clock className="w-3 h-3 mr-1" aria-hidden="true" />{state.label}</>}
                    </Badge>
                  </div>

                  {/*
                    The accessible name has to start with the words on the
                    button. Someone driving the phone by voice says what they
                    can see — "got twenty one forty from Alice" — and if the
                    aria-label reads "Confirm Alice paid $21.40" instead, the
                    command matches nothing (WCAG 2.5.3, Label in Name).
                  */}
                  {isHost && (
                    settled ? (
                      <Button
                        variant="outline"
                        onClick={() => undoPaid(p.participant_id)}
                        className="w-full h-11 text-sm rounded-xl"
                      >
                        Undo — {p.name} has not paid
                      </Button>
                    ) : (
                      <Button
                        onClick={() => confirmPaid(p.participant_id)}
                        aria-label={`Got $${owes.toFixed(2)} from ${p.name} — confirm this payment`}
                        className="w-full h-12 text-sm font-bold bg-success hover:bg-success/90 text-white rounded-xl"
                      >
                        <CheckCircle2 className="w-4 h-4 mr-2" aria-hidden="true" />
                        Got ${owes.toFixed(2)} from {p.name}
                      </Button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
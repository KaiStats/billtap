import { useState, useEffect, useCallback, memo, useRef } from "react";
import { invoke } from "@/api/functions";
import { useNavigate } from "react-router";
import { getHostKey } from "@/lib/hostKey";
import { useLiveSplit } from "@/hooks/useLiveSplit";
import { QRCodeSVG } from "qrcode.react";
import confetti from "canvas-confetti";
import { Copy, Check, Users, ArrowRight, MessageSquare, Mail, Share2, DollarSign, Settings } from "lucide-react";
import { tableFairness } from '@/lib/fairness';
import { shareCardLines, drawShareCard, shareCardImage } from '@/lib/shareCard';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import CustomSplitConfig from "@/components/CustomSplitConfig";
import { sessionPath, claimUrl as sessionClaimUrl } from '@/lib/sessionLinks';

function SessionHostComponent() {
  const navigate = useNavigate();

  /**
   * No sign-in gate.
   *
   * This screen used to bounce anyone unauthenticated to the landing page,
   * which meant the host of a table-tent split could never see it — and this is
   * where the QR code lives. They had made a split that nobody could be invited
   * to join, and no way to enter the Venmo handle everyone was meant to pay.
   *
   * Being the host is proven by the secret minted at creation, not by having an
   * account: every read and write below carries it, and the Worker answers 403
   * without it. See src/lib/hostKey.js.
   */
  const [session, setSession] = useState(null);
  /**
   * How full this split may get, from the endpoint that does the refusing.
   *
   * The eleventh guest already sees why they were turned away, and they are the
   * wrong person to show an upsell to — they cannot upgrade anything, they are
   * somebody's friend at dinner. This screen belongs to the person who can.
   */
  const [party, setParty] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showPaymentSetup, setShowPaymentSetup] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentHandle, setPaymentHandle] = useState("");
  const [qrToken, setQrToken] = useState(null);
  const [qrTokenExpiry, setQrTokenExpiry] = useState(null);
  const [showSplitConfig, setShowSplitConfig] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [customSplitData, setCustomSplitData] = useState(null);
  const [allPaidCelebrated, setAllPaidCelebrated] = useState(false);
  const [showSummaryCard, setShowSummaryCard] = useState(false);
  const celebratedRef = useRef(false);
  const qrTokenExpiryRef = useRef(null);

  const sessionId = new URLSearchParams(window.location.search).get("id");
  const participants = session?.participants || [];
  const totalItems = (session?.items || []).length;
  const claimedItems = (session?.items || []).filter(i => (i.claimed_by || []).length > 0).length;

  // Generate a fresh signed QR token (refreshes every 25 min)
  const refreshQrToken = useCallback(async () => {
    if (!sessionId) return;
    const res = await invoke("generateQRSignature", {
      session_id: sessionId,
      host_key: getHostKey(sessionId),
    });
    if (res.data?.qr_token) {
      setQrToken(res.data.qr_token);
      const expiry = Date.now() + 25 * 60 * 1000; // refresh before 30-min expiry
      // Mirrored into a ref as well as state. The refresh interval below reads
      // the ref, so it can check freshness without taking a dependency on a
      // value this function sets — which is what made the effect re-run and
      // re-fire itself.
      qrTokenExpiryRef.current = expiry;
      setQrTokenExpiry(expiry);
    }
  }, [sessionId]);

  // Both encoded. The token is already base64url from b64url() in the Worker,
  // but a link builder that encodes one parameter and not the other is a link
  // builder somebody will extend wrongly. See src/lib/sessionLinks.js.
  const claimUrl = qrToken
    ? `${window.location.origin}/claim?${new URLSearchParams({ token: qrToken })}`
    : sessionClaimUrl(window.location.origin, sessionId);

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await invoke("getSessionAsHost", {
        session_id: sessionId,
        host_key: getHostKey(sessionId),
      });
      if (res.data?.session) {
        setSession(res.data.session);
        // Only the host view carries this. The scoped read below is what a
        // guest holding the link gets, and it says nothing about plans.
        setParty(res.data.party || null);
        return;
      }
    } catch {
      // Not the host, or the key is gone. Fall through to the scoped read that
      // anyone holding the link may make.
    }
    try {
      const res = await invoke("getSplitStatus", { session_id: sessionId });
      if (res.data?.session) setSession(res.data.session);
    } catch {
      // Nothing to show, and nothing useful to say about it here — the host
      // screen already renders its own empty state.
    }
  }, [sessionId]);

  useEffect(() => { fetchSession(); }, [fetchSession]);

  // Generate a signed QR token on mount, then refresh it shortly before expiry.
  //
  // qrTokenExpiry must NOT be a dependency here. refreshQrToken sets it, so
  // listing it meant: effect runs, mints a token, sets expiry, effect re-runs
  // because expiry changed, mints another token, and so on for as long as the
  // host page stayed open. Every iteration is a generateQRSignature invocation,
  // and the host page is the one people leave open on the table all evening.
  //
  // The interval reads the expiry from a ref instead, which is exactly the case
  // refs exist for: state the callback needs to see but must not re-subscribe
  // to.
  useEffect(() => {
    refreshQrToken();
    const interval = setInterval(() => {
      const expiry = qrTokenExpiryRef.current;
      if (!expiry || Date.now() > expiry) refreshQrToken();
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshQrToken]);

  // Watching the table fill up: guests joining, items being claimed, payments
  // landing. Reads as the host, so the amounts are the real ones.
  useLiveSplit(sessionId, { hostKey: getHostKey(sessionId), onUpdate: setSession });

  // Celebrate when the host has confirmed every payment.
  //
  // This used to fire on pending_verification too — the state a diner reaches
  // by tapping "I've sent payment", which is an assertion, not an arrival. So
  // the confetti went off when everyone *said* they had paid, and the host was
  // told the bill was settled before a single transfer had been checked. On the
  // receipt screen the same table read 0 of 5. Only one of those was true.
  useEffect(() => {
    if (!session || celebratedRef.current) return;
    const ps = session.participants || [];
    if (ps.length > 0 && ps.every(p => p.payment_status === "paid")) {
      celebratedRef.current = true;
      setAllPaidCelebrated(true);
      if (navigator.vibrate) navigator.vibrate([50, 50, 100]);
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.5 }, colors: ['#00c896', '#2ee6b0', '#38bdf8', '#f8fafc', '#00c896'] });
      setTimeout(() => confetti({ particleCount: 60, spread: 100, origin: { y: 0.3 } }), 400);
    }
  }, [session]);

  const copyLink = () => {
    navigator.clipboard.writeText(claimUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareViaText = () => {
    const msg = encodeURIComponent(`Join me to split the bill on BillTap!\n${claimUrl}`);
    window.location.href = `sms:?body=${msg}`;
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent("Split our bill with BillTap");
    const body = encodeURIComponent(`Hey! Join me to claim your items:\n${claimUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const shareNative = async () => {
    if (navigator.share) {
      await navigator.share({ title: "Split bill with BillTap", text: "Join me to claim your items!", url: claimUrl });
    } else {
      copyLink();
    }
  };

  /**
   * The finished split, as a picture.
   *
   * This used to share `summaryText` — three lines of plain text, offered
   * underneath a card that was already designed and already on screen. The
   * picture existed and was discarded at the exact moment of sharing.
   *
   * The headline is the table's fairness number rather than the total, because
   * "$284 split six ways" is a receipt and "$47 went back to the people who
   * did not order the wine" is a story. When there is no such number — a table
   * where everybody ordered much the same — the card says so instead of
   * inventing one. See src/lib/fairness.js and src/lib/shareCard.js.
   */
  const shareSummaryCard = async () => {
    const rows = session?.participants || [];
    const minutes = session?.created_date
      ? Math.max(1, Math.round((Date.now() - new Date(session.created_date).getTime()) / 60000))
      : null;
    const fairness = tableFairness({
      totalAmount: session?.total_amount,
      participants: rows,
      splitMode: session?.split_mode,
    });

    const lines = shareCardLines({
      title: session?.title,
      people: rows.length,
      total: session?.total_amount,
      minutes,
      fairness,
    });
    const blob = await drawShareCard(lines);
    await shareCardImage({
      blob,
      text: fairness
        ? `Split dinner with BillTap — $${fairness.moved.toFixed(2)} went back to the people who actually ordered it.`
        : `Split dinner with BillTap — ${rows.length} people, everyone paid their own way.`,
    });
  };

  const saveSettings = (changes) =>
    invoke("updateSplitSettings", {
      session_id: sessionId,
      host_key: getHostKey(sessionId),
      ...changes,
    });

  const startClaiming = async () => {
    await saveSettings({ status: "claiming" });
    // To the claim screen, because the host is at the table eating too. From
    // there they can reach the who-has-paid screen. It used to go straight to
    // /receipt-detail with ?host=1, a flag that meant nothing to the server.
    navigate(sessionPath('/claim', sessionId));
  };

  const savePaymentInfo = async () => {
    if (!paymentMethod || !paymentHandle.trim()) { setShowPaymentSetup(false); return; }
    try {
      const res = await saveSettings({
        host_payment_info: { method: paymentMethod, handle: paymentHandle.trim() },
      });
      if (res.data?.session) setSession(res.data.session);
      setShowPaymentSetup(false);
    } catch (err) {
      // This is the one setting the whole table depends on — without it the
      // claim screen has nowhere to send anyone's money. Failing quietly here
      // would look like it saved.
      setSaveError(err?.message || "Could not save that. Check your connection and try again.");
    }
  };

  const saveCustomSplit = async () => {
    if (!customSplitData?.isValid || !customSplitData.finalAmounts) return;
    try {
      // Amounts only. The server applies them to the stored participants and
      // refuses a set that does not add up to the bill, rather than trusting a
      // participants array assembled in the browser.
      const res = await saveSettings({ custom_amounts: customSplitData.finalAmounts });
      if (res.data?.session) setSession(res.data.session);
      setShowSplitConfig(false);
    } catch (err) {
      setSaveError(err?.message || "Could not save those amounts.");
    }
  };

  const handleStartClaimingClick = () => {
    if (!session.host_payment_info) setShowPaymentSetup(true);
    else startClaiming();
  };

  if (!sessionId) return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground text-center px-6">
      <div><p className="text-lg font-semibold">No session found</p><p className="text-sm mt-1">Please create a new split first.</p></div>
    </div>
  );

  if (!session) return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground" role="status" aria-live="polite" aria-busy="true">

      <div className="text-center flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" aria-hidden="true" />
        <span aria-hidden="true">Loading session…</span>
      </div>
    </div>
  );



  return (
    <div
      className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden"
      style={{ background: 'linear-gradient(165deg, #070b16 0%, #0d1728 55%, #070b16 100%)' }}
    >
      {/* Glow blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div style={{ position:'absolute', top:'-10%', left:'-15%', width:'60vw', height:'60vw', maxWidth:400, maxHeight:400, borderRadius:'50%', background:'radial-gradient(circle, rgba(0,200,150,0.35) 0%, transparent 70%)', filter:'blur(60px)' }} />
        <div style={{ position:'absolute', bottom:'-10%', right:'-15%', width:'55vw', height:'55vw', maxWidth:350, maxHeight:350, borderRadius:'50%', background:'radial-gradient(circle, rgba(0,200,150,0.28) 0%, transparent 70%)', filter:'blur(60px)' }} />
      </div>

      <div className="relative z-10 max-w-sm w-full space-y-5">
        {/* Header */}
        <div className="text-center">
          <div className="text-4xl mb-2">🎉</div>
          <h1 className="text-2xl font-black text-white tracking-tight">Your bill is ready!</h1>
          <p className="text-white/60 mt-1 text-sm">{session.title} ·{' '}
            <span className="mono text-white font-bold tabular-nums">${(session.total_amount || 0).toFixed(2)}</span>
          </p>
        </div>

        {/* Main card */}
        <div
          className="rounded-3xl p-6 space-y-5"
          style={{ background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.15)' }}
        >
          {/* Payment Setup Modal */}
          {showPaymentSetup && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setShowPaymentSetup(false)}>
              <Card className="w-full max-w-sm rounded-2xl" onClick={e => e.stopPropagation()}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <DollarSign className="w-5 h-5" /> How should guests pay you?
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    {["venmo","cashapp","zelle"].map(m => (
                      <Button key={m} variant={paymentMethod === m ? "default" : "outline"} onClick={() => setPaymentMethod(m)} className={`capitalize ${paymentMethod === m ? "bg-brand hover:bg-brand/90" : ""}`}>
                        {m === "cashapp" ? "Cash App" : m.charAt(0).toUpperCase() + m.slice(1)}
                      </Button>
                    ))}
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">{paymentMethod === "zelle" ? "Phone or Email" : "@Username"}</label>
                    <Input value={paymentHandle} onChange={e => setPaymentHandle(e.target.value)} placeholder={paymentMethod === "zelle" ? "e.g. (555) 123-4567" : "e.g. @yourname"} className="rounded-xl" autoFocus />
                  </div>
                  {saveError && (
                    <p role="alert" className="text-sm text-danger-muted-foreground bg-danger-muted rounded-xl px-3 py-2">
                      {saveError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button onClick={savePaymentInfo} className="flex-1 bg-brand hover:bg-brand/90">Continue</Button>
                    <Button variant="outline" onClick={() => setShowPaymentSetup(false)}>Skip</Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Custom Split Configuration Modal */}
          {showSplitConfig && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={() => setShowSplitConfig(false)}>
              <Card className="w-full max-w-lg rounded-2xl my-8" onClick={e => e.stopPropagation()}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Settings className="w-5 h-5" /> Configure Custom Split
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 max-h-[70vh] overflow-y-auto">
                  {participants.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="font-semibold mb-2">No guests yet</p>
                      <p className="text-sm">Share the QR code first, then configure custom splits after guests join.</p>
                    </div>
                  ) : (
                    <>
                      <CustomSplitConfig
                        participants={participants}
                        totalAmount={session.total_amount || 0}
                        onChange={setCustomSplitData}
                      />
                      <div className="flex gap-2 pt-2">
                        <Button 
                          onClick={saveCustomSplit} 
                          disabled={!customSplitData?.isValid}
                          className="flex-1 bg-brand hover:bg-brand/90"
                        >
                          Save Split
                        </Button>
                        <Button variant="outline" onClick={() => setShowSplitConfig(false)}>Cancel</Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/*
            Where the money actually goes — asked before the QR, not after.

            ── What this fixes ────────────────────────────────────────────────

            The payment handle was only ever requested from
            handleStartClaimingClick, behind the "Claim My Items" button. A host
            who does the obvious thing -- show the QR, let the table scan --
            never saw it.

            So guests claimed their items, tapped "Pay $52.44", and were told
            "ask the host how they want to be paid". Then the split marked them
            as sent anyway, and the host got a confirmed list describing money
            that had never moved. The one thing the product exists to finish was
            the one thing it did not.

            Above the QR because that is the order the host works in: this
            screen exists to be held up to a table, and anything below the code
            is read after everyone has already scanned.

            A nudge and not a wall. A host who wants to share the code first, or
            who is collecting cash, must not be blocked by us -- the split still
            works without a handle, it just cannot tell anyone where to send
            money. See how the guest handles its absence in src/pages/Claim.jsx.
          */}
          {!session.host_payment_info && (
            <button
              type="button"
              onClick={() => setShowPaymentSetup(true)}
              className="w-full text-left rounded-2xl p-4 flex items-start gap-3 transition active:scale-[0.99]"
              style={{ background: "rgba(240,180,41,.10)", border: "1px solid rgba(240,180,41,.35)" }}
            >
              <DollarSign className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#f0b429" }} aria-hidden="true" />
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-sm text-white">
                  Guests can&apos;t pay you yet
                </span>
                <span className="block text-xs mt-1 text-white/60">
                  Add your Venmo, Cash App or Zelle so everyone knows where to send it.
                </span>
              </span>
              <span className="text-xs font-semibold shrink-0 mt-0.5" style={{ color: "#f0b429" }}>Add →</span>
            </button>
          )}

          {/* QR Code */}
          <div className="flex flex-col items-center gap-3">
            <div className="bg-white p-4 rounded-2xl shadow-xl" role="img" aria-label={`QR code to join: ${session.title}`}>
              <QRCodeSVG value={claimUrl} size={200} fgColor="#0a1120" level="H" includeMargin={false} />
            </div>
            <p className="text-white/60 font-medium text-sm text-center">Have everyone scan this 📱</p>
          </div>

          {/* Link */}
          <div
            className="flex gap-2 items-center rounded-xl p-3"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <span className="text-xs text-white/50 font-mono flex-1 truncate">{claimUrl}</span>
            <Button size="sm" variant="outline" onClick={copyLink} className="rounded-lg shrink-0 h-7 px-3 border-white/20 text-white hover:bg-white/10">
              {copied
                ? <><Check className="w-3 h-3 text-emerald-400 mr-1" aria-hidden="true" /><span className="text-xs text-emerald-400">Copied!</span></>
                : <><Copy className="w-3 h-3 mr-1" aria-hidden="true" /><span className="text-xs">Copy</span></>}
            </Button>
          </div>

          {/* Live Participants */}
          <div
            className="flex items-center justify-between rounded-xl p-3"
            style={{ background: 'rgba(0,200,150,0.15)', border: '1px solid rgba(0,200,150,0.25)' }}
          >
            <div className="flex items-center gap-2 text-white/80 font-semibold text-sm">
              <Users className="w-4 h-4" aria-hidden="true" />
              {participants.length === 0 ? "Waiting for guests…" : `${participants.length} joined`}
            </div>
            <div className="flex gap-1">
              {participants.slice(0, 6).map((p, i) => (
                <div key={i} aria-label={p.name || "Guest"} className="w-7 h-7 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs font-bold shadow-sm ring-2 ring-background">
                  {(p.name || "?")[0].toUpperCase()}
                </div>
              ))}
              {participants.length > 6 && (
                <div className="w-7 h-7 bg-white/10 text-white/60 rounded-full flex items-center justify-center text-xs">+{participants.length - 6}</div>
              )}
            </div>
          </div>

          {/*
            The table is as big as this plan allows.

            Shown at the limit rather than after somebody has been refused:
            being told at ten that the next person will not fit is worth more
            than being told at eleven that they did not. It is also the only
            warning that reaches the host at all — the refusal happens on a
            stranger's phone.

            Restaurant tables never see this. Their limit is the row ceiling,
            not a consumer tier, because the restaurant already pays $149.
          */}
          {party?.full && party.tier === "free" && (
            <div
              className="rounded-2xl p-4 flex items-start gap-3"
              style={{ background: "rgba(0,200,150,.08)", border: "1px solid rgba(0,200,150,.25)" }}
            >
              <Users className="w-5 h-5 shrink-0 mt-0.5 text-primary" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-white">
                  That&apos;s {party.limit} people — the table is full
                </p>
                <p className="text-xs mt-1 text-white/55">
                  Anyone else who scans will be turned away. Pro lifts the limit for $3.99/month.
                </p>
                <button
                  type="button"
                  onClick={() => navigate("/#pricing")}
                  className="mt-3 px-4 py-2 rounded-xl font-semibold text-xs bg-primary text-primary-foreground"
                >
                  See Pro
                </button>
              </div>
            </div>
          )}

          {/* Configure Split Button (for custom mode or to switch to custom) */}
          {participants.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setShowSplitConfig(true)}
              className="w-full h-12 rounded-xl border-white/20 text-white hover:bg-white/10"
            >
              <Settings className="w-4 h-4 mr-2" />
              {session.split_mode === "custom" ? "Edit Custom Split" : "Configure Custom Split"}
            </Button>
          )}

          {/* Split Mode Indicator */}
          {session.split_mode === "custom" && (
            <div className="rounded-xl p-3 bg-info-muted border border-info/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-info-muted-foreground font-semibold text-sm">
                  <Settings className="w-4 h-4" />
                  Custom Split Active
                </div>
                <Button size="sm" variant="outline" onClick={() => setShowSplitConfig(true)} className="text-xs h-8">
                  Edit
                </Button>
              </div>
            </div>
          )}

          {/* Payment Progress */}
          {participants.length > 0 && (() => {
            const paidCount = participants.filter(p => p.payment_status === "paid").length;
            const awaitingCount = participants.filter(p => p.payment_status === "pending_verification").length;
            const pct = Math.round((paidCount / participants.length) * 100);
            const allDone = paidCount === participants.length;
            const waitingForLast = paidCount === participants.length - 1 && participants.length > 1;
            return (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className={allDone ? "text-emerald-400" : "text-white/60"}>
                    {allDone
                      ? "🎉 Everyone paid!"
                      : awaitingCount > 0
                        ? `${paidCount} of ${participants.length} confirmed · ${awaitingCount} to check`
                        : `${paidCount} of ${participants.length} confirmed`}
                  </span>
                  <span className={allDone ? "text-emerald-400" : "text-white/40"}>{pct}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={paidCount}
                  aria-valuemin={0}
                  aria-valuemax={participants.length}
                  aria-label={`${paidCount} of ${participants.length} payments confirmed`}
                  className="w-full bg-white/10 rounded-full h-2.5 overflow-hidden"
                >
                  <div
                    className={`h-2.5 rounded-full transition-all duration-700 ${waitingForLast ? "animate-pulse" : ""}`}
                    style={{
                      width: `${pct}%`,
                      background: allDone
                        ? 'linear-gradient(90deg, #00c896, #34d399)'
                        : 'linear-gradient(90deg, #00c896, #2ee6b0)',
                    }}
                  />
                </div>
              </div>
            );
          })()}

          {/* Items claimed progress */}
          {session.status === "claiming" && totalItems > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-white/50">
                <span>Items claimed</span><span>{claimedItems}/{totalItems}</span>
              </div>
              <div role="progressbar" aria-valuenow={claimedItems} aria-valuemin={0} aria-valuemax={totalItems} aria-label="Items claimed" className="w-full bg-white/10 rounded-full h-2">
                <div className="h-2 rounded-full transition-all" style={{ width: `${(claimedItems / totalItems) * 100}%`, background: 'linear-gradient(90deg, #00c896, #2ee6b0)' }} />
              </div>
            </div>
          )}

          {/* All paid celebration banner */}
          {allPaidCelebrated && (
            <div
              className="rounded-2xl p-4 text-center space-y-3"
              style={{ background: 'linear-gradient(135deg, rgba(0,200,150,0.15), rgba(52,211,153,0.1))', border: '1px solid rgba(0,200,150,0.3)' }}
            >
              <p className="text-emerald-300 font-black text-lg">🎉 Everyone's paid! Enjoy your meal!</p>
              <button
                onClick={() => setShowSummaryCard(true)}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
                style={{ background: 'rgba(0,200,150,0.25)', border: '1px solid rgba(0,200,150,0.4)' }}
              >
                Share Split Summary ↗
              </button>
            </div>
          )}

          {/* Primary CTA */}
          <button
            onClick={handleStartClaimingClick}
            // Starts with the words on the button, so a voice-control user
            // saying what they can see actually hits it (WCAG 2.5.3).
            aria-label={session.status === "claiming"
              ? "View Progress — see who has claimed and paid"
              : "Claim My Items from the bill"}
            className="press w-full h-14 bg-primary text-primary-foreground font-bold rounded-2xl flex items-center justify-center gap-2 shadow-glow transition hover:brightness-110"
          >
            {session.status === "claiming" ? "View Progress" : "Claim My Items"}
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </button>

          {/* Split Summary Modal */}
          {showSummaryCard && (() => {
            const minutesTaken = session.created_date ? Math.max(1, Math.round((Date.now() - new Date(session.created_date).getTime()) / 60000)) : null;
            // The table's fairness number, shown on the card the host is
            // looking at as well as on the one they share. See shareSummaryCard.
            const fairness = tableFairness({
              totalAmount: session.total_amount,
              participants,
              splitMode: session.split_mode,
            });
            return (
              <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end justify-center p-4 z-50" onClick={() => setShowSummaryCard(false)}>
                <div
                  className="w-full max-w-sm rounded-3xl p-6 space-y-4 text-center"
                  onClick={e => e.stopPropagation()}
                  style={{ background: 'linear-gradient(165deg, #070b16 0%, #0d1728 100%)', border: '1px solid rgba(255,255,255,0.12)' }}
                >
                  <div className="text-4xl">🎉</div>
                  <div className="space-y-1">
                    <p className="text-white font-black text-lg">BillTap split at</p>
                    <p className="text-brand font-black text-2xl">{session.title}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 py-2">
                    {[
                      { label: "People", value: participants.length },
                      { label: "Total", value: `$${(session.total_amount || 0).toFixed(2)}` },
                      { label: minutesTaken ? `${minutesTaken}min ⚡` : "Done", value: "Paid ✓" },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <div className="mono text-white font-semibold text-lg tabular-nums">{value}</div>
                        <div className="text-white/40 text-xs">{label}</div>
                      </div>
                    ))}
                  </div>

                  {/*
                    The line that makes this worth sharing.

                    "6 people, $284" is a receipt. "$47 went back to the people
                    who did not order the wine" is a story, and it is the same
                    data. Absent when the table ordered much the same — see
                    src/lib/fairness.js for why that case invents nothing.
                  */}
                  {fairness && (
                    <div className="rounded-xl py-3 px-4" style={{ background: 'rgba(0,200,150,0.1)', border: '1px solid rgba(0,200,150,0.25)' }}>
                      <div className="mono font-black text-xl tabular-nums" style={{ color: '#00c896' }}>
                        ${fairness.moved.toFixed(2)}
                      </div>
                      <div className="text-white/50 text-xs mt-0.5">
                        went back to the {fairness.spared} {fairness.spared === 1 ? "person" : "people"} who ordered less
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={shareSummaryCard}
                      className="press flex-1 h-12 rounded-xl font-bold bg-primary text-primary-foreground text-sm shadow-glow transition hover:brightness-110"
                    >
                      Share Summary
                    </button>
                    <button onClick={() => setShowSummaryCard(false)} className="h-12 px-4 rounded-xl font-bold text-white/50 text-sm" style={{ background: 'rgba(255,255,255,0.05)' }}>
                      Close
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Share Options */}
          <div>
            <p className="text-center text-xs text-white/40 mb-3">Or share via</p>
            <div className="flex gap-2 justify-center">
              {[
                { label: "Text",  icon: MessageSquare, onClick: shareViaText },
                { label: "Email", icon: Mail,          onClick: shareViaEmail },
                { label: "More",  icon: Share2,        onClick: shareNative },
              ].map(({ label, icon: Icon, onClick }) => (
                <button key={label} onClick={onClick} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold text-white/70 hover:text-white transition-colors" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(SessionHostComponent);
import { useState, useEffect, useCallback, memo, useRef } from "react";
import { invoke } from "@/api/functions";
import { useNavigate } from "react-router-dom";
import { getHostKey } from "@/lib/hostKey";
import { useLiveSplit } from "@/hooks/useLiveSplit";
import { QRCodeSVG } from "qrcode.react";
import confetti from "canvas-confetti";
import { Copy, Check, Users, ArrowRight, MessageSquare, Mail, Share2, DollarSign, Settings } from "lucide-react";
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
      if (res.data?.session) { setSession(res.data.session); return; }
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
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.5 }, colors: ['#667eea', '#f093fb', '#f5576c', '#00c896', '#d4af37'] });
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
      style={{ background: 'linear-gradient(160deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' }}
    >
      {/* Glow blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div style={{ position:'absolute', top:'-10%', left:'-15%', width:'60vw', height:'60vw', maxWidth:400, maxHeight:400, borderRadius:'50%', background:'radial-gradient(circle, rgba(102,126,234,0.35) 0%, transparent 70%)', filter:'blur(60px)' }} />
        <div style={{ position:'absolute', bottom:'-10%', right:'-15%', width:'55vw', height:'55vw', maxWidth:350, maxHeight:350, borderRadius:'50%', background:'radial-gradient(circle, rgba(245,87,108,0.28) 0%, transparent 70%)', filter:'blur(60px)' }} />
      </div>

      <div className="relative z-10 max-w-sm w-full space-y-5">
        {/* Header */}
        <div className="text-center">
          <div className="text-4xl mb-2">🎉</div>
          <h1 className="text-2xl font-black text-white tracking-tight">Your bill is ready!</h1>
          <p className="text-white/60 mt-1 text-sm">{session.title} ·{' '}
            <span className="text-white font-bold">${(session.total_amount || 0).toFixed(2)}</span>
          </p>
        </div>

        {/* Main card */}
        <div
          className="rounded-3xl p-6 space-y-5"
          style={{ background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.15)' }}
        >
          {/* Payment Setup Modal */}
          {/*
            overflow-y-auto for the same reason the split-config modal below has
            it, and more urgently: the handle field is autoFocus, so the keyboard
            is up the moment this opens and the viewport is roughly a third of
            the screen. Without a scroller a fixed overlay clips its own content
            with no way to reach it — here that would be the question "How should
            guests pay you?" disappearing off the top while the host is being
            asked to answer it.
          */}
          {showPaymentSetup && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={() => setShowPaymentSetup(false)}>
              <Card className="w-full max-w-sm rounded-2xl my-auto" onClick={e => e.stopPropagation()}>
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

          {/* QR Code */}
          <div className="flex flex-col items-center gap-3">
            <div className="bg-white p-4 rounded-2xl shadow-xl" role="img" aria-label={`QR code to join: ${session.title}`}>
              <QRCodeSVG value={claimUrl} size={200} fgColor="#302b63" level="H" includeMargin={false} />
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
            style={{ background: 'rgba(102,126,234,0.15)', border: '1px solid rgba(102,126,234,0.25)' }}
          >
            <div className="flex items-center gap-2 text-white/80 font-semibold text-sm">
              <Users className="w-4 h-4" aria-hidden="true" />
              {participants.length === 0 ? "Waiting for guests…" : `${participants.length} joined`}
            </div>
            <div className="flex gap-1">
              {participants.slice(0, 6).map((p, i) => (
                <div key={i} aria-label={p.name || "Guest"} className="w-7 h-7 bg-gradient-to-br from-violet-500 to-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-sm">
                  {(p.name || "?")[0].toUpperCase()}
                </div>
              ))}
              {participants.length > 6 && (
                <div className="w-7 h-7 bg-white/10 text-white/60 rounded-full flex items-center justify-center text-xs">+{participants.length - 6}</div>
              )}
            </div>
          </div>

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
            <div className="rounded-xl p-3 bg-purple-500/10 border border-purple-500/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-purple-300 font-semibold text-sm">
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
                        : 'linear-gradient(90deg, #667eea, #f093fb)',
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
                <div className="h-2 rounded-full transition-all" style={{ width: `${(claimedItems / totalItems) * 100}%`, background: 'linear-gradient(90deg, #667eea, #f093fb)' }} />
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
            className="w-full h-14 text-white font-black rounded-2xl flex items-center justify-center gap-2 shadow-2xl transition-all hover:-translate-y-0.5 active:translate-y-0"
            style={{ background: 'linear-gradient(135deg, #f5576c, #f093fb)' }}
          >
            {session.status === "claiming" ? "View Progress" : "Claim My Items"}
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </button>

          {/* Split Summary Modal */}
          {showSummaryCard && (() => {
            const paidCount = participants.filter(p => p.payment_status === "paid").length;
            const minutesTaken = session.created_date ? Math.max(1, Math.round((Date.now() - new Date(session.created_date).getTime()) / 60000)) : null;
            const summaryText = `BillTap split at ${session.title}\n${participants.length} people · $${(session.total_amount || 0).toFixed(2)} total\nEveryone paid${minutesTaken ? ` in ${minutesTaken} minute${minutesTaken !== 1 ? 's' : ''}` : ''} ⚡`;
            return (
              <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end justify-center p-4 z-50" onClick={() => setShowSummaryCard(false)}>
                <div
                  className="w-full max-w-sm rounded-3xl p-6 space-y-4 text-center"
                  onClick={e => e.stopPropagation()}
                  style={{ background: 'linear-gradient(160deg, #0f0c29 0%, #1a1535 100%)', border: '1px solid rgba(255,255,255,0.12)' }}
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
                        <div className="text-white font-black text-lg">{value}</div>
                        <div className="text-white/40 text-xs">{label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (navigator.share) {
                          navigator.share({ title: 'BillTap Split', text: summaryText });
                        } else {
                          navigator.clipboard.writeText(summaryText);
                        }
                      }}
                      className="flex-1 h-12 rounded-xl font-bold text-white text-sm transition-all active:scale-95"
                      style={{ background: 'linear-gradient(135deg, #f5576c, #f093fb)' }}
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
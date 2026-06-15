import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { useTabNav } from "@/lib/TabNavigationContext";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, Users, ArrowRight, MessageSquare, Mail, Share2, DollarSign, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import SplitConfigModal from "@/components/SplitConfigModal";
import CustomSplitConfig from "@/components/CustomSplitConfig";

function SessionHostComponent() {
  const { pushScreen } = useTabNav();
  const [session, setSession] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showPaymentSetup, setShowPaymentSetup] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentHandle, setPaymentHandle] = useState("");
  const [qrToken, setQrToken] = useState(null);
  const [qrTokenExpiry, setQrTokenExpiry] = useState(null);
  const [showSplitConfig, setShowSplitConfig] = useState(false);
  const [customSplitData, setCustomSplitData] = useState(null);

  const sessionId = new URLSearchParams(window.location.search).get("id");

  // Generate a fresh signed QR token (refreshes every 25 min)
  const refreshQrToken = useCallback(async () => {
    if (!sessionId) return;
    const res = await base44.functions.invoke("generateQRSignature", { session_id: sessionId });
    if (res.data?.qr_token) {
      setQrToken(res.data.qr_token);
      setQrTokenExpiry(Date.now() + 25 * 60 * 1000); // refresh before 30-min expiry
    }
  }, [sessionId]);

  const claimUrl = qrToken
    ? `${window.location.origin}/Claim?token=${qrToken}`
    : `${window.location.origin}/Claim?id=${sessionId}`;

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    const data = await base44.entities.Session.list("-created_date", 200);
    const found = data.find(s => s.id === sessionId);
    if (found) setSession(found);
  }, [sessionId]);

  useEffect(() => { fetchSession(); }, [fetchSession]);

  // Generate signed QR token on mount and refresh before expiry
  useEffect(() => {
    refreshQrToken();
    const interval = setInterval(() => {
      if (!qrTokenExpiry || Date.now() > qrTokenExpiry) refreshQrToken();
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshQrToken, qrTokenExpiry]);

  useEffect(() => {
    if (!sessionId) return;
    const unsub = base44.entities.Session.subscribe((event) => {
      if (event.id === sessionId && event.data) setSession(event.data);
    });
    return unsub;
  }, [sessionId]);

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

  const startClaiming = async () => {
    await base44.entities.Session.update(sessionId, { status: "claiming" });
    pushScreen(createPageUrl(`Claim?id=${sessionId}`));
  };

  const savePaymentInfo = async () => {
    if (!paymentMethod || !paymentHandle.trim()) { setShowPaymentSetup(false); return; }
    await base44.entities.Session.update(sessionId, {
      host_payment_info: { method: paymentMethod, handle: paymentHandle.trim() }
    });
    setShowPaymentSetup(false);
  };

  const saveCustomSplit = async () => {
    if (!customSplitData?.isValid || !customSplitData.finalAmounts) return;
    
    const updatedParticipants = participants.map(p => ({
      ...p,
      amount_owed: customSplitData.finalAmounts[p.participant_id] || 0,
      payment_status: p.payment_status || "unpaid",
    }));

    await base44.entities.Session.update(sessionId, {
      split_mode: "custom",
      custom_split_config: {
        type: customSplitData.subMode,
        values: customSplitData.finalAmounts,
      },
      participants: updatedParticipants,
    });
    setShowSplitConfig(false);
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


  const participants = session?.participants || [];
  const totalItems   = (session?.items || []).length;
  const claimedItems = useMemo(
    () => (session?.items || []).filter(i => (i.claimed_by || []).length > 0).length,
    [session?.items]
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

          {/* Split Configuration Modal */}
          {showSplitConfig && (
            <SplitConfigModal
              session={session}
              onClose={() => setShowSplitConfig(false)}
              onUpdate={(updated) => setSession(updated)}
            />
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

          {/* Progress */}
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

          {/* Primary CTA */}
          <button
            onClick={handleStartClaimingClick}
            aria-label={session.status === "claiming" ? "View claiming progress" : "Claim my items from the bill"}
            className="w-full h-14 text-white font-black rounded-2xl flex items-center justify-center gap-2 shadow-2xl transition-all hover:-translate-y-0.5 active:translate-y-0"
            style={{ background: 'linear-gradient(135deg, #f5576c, #f093fb)' }}
          >
            {session.status === "claiming" ? "View Progress" : "Claim My Items"}
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </button>

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
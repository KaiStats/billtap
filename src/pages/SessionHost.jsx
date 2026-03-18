import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { useTabNav } from "@/lib/TabNavigationContext";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, Users, ArrowRight, MessageSquare, Mail, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function SessionHost() {
  const { pushScreen } = useTabNav();
  const [session, setSession] = useState(null);
  const [copied, setCopied] = useState(false);

  const sessionId = new URLSearchParams(window.location.search).get("id");
  const claimUrl = `${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, "")}#/Claim?id=${sessionId}`;

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    const data = await base44.entities.Session.filter({ id: sessionId });
    if (data[0]) setSession(data[0]);
  }, [sessionId]);

  useEffect(() => {
    fetchSession();
    let interval = setInterval(fetchSession, 3000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearInterval(interval);
      } else {
        fetchSession();
        interval = setInterval(fetchSession, 3000);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchSession]);

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
    const msg = encodeURIComponent(`Join me to split the bill!\n${claimUrl}`);
    window.location.href = `sms:?body=${msg}`;
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent("Split our bill with Divvy");
    const body = encodeURIComponent(`Hey! Join me to claim your items:\n${claimUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const shareNative = async () => {
    if (navigator.share) {
      await navigator.share({ title: "Split bill with Divvy", text: "Join me to claim your items!", url: claimUrl });
    } else {
      copyLink();
    }
  };

  const startClaiming = async () => {
    await base44.entities.Session.update(sessionId, { status: "claiming" });
    pushScreen(createPageUrl(`Claim?id=${sessionId}`));
  };

  if (!session) return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground" role="status" aria-live="polite">
      <div className="text-center flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" aria-hidden="true" />
        <span>Loading session…</span>
      </div>
    </div>
  );

  const participants = session.participants || [];
  const totalItems = (session.items || []).length;
  const claimedItems = (session.items || []).filter(i => (i.claimed_by || []).length > 0).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand to-info flex items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-5">
        {/* Header */}
        <div className="text-center text-brand-foreground">
          <div className="text-4xl mb-2">🎉</div>
          <h1 className="text-2xl font-black">Your bill is ready!</h1>
          <p className="text-brand-foreground/70 mt-1 text-sm">{session.title} · ${(session.total_amount || 0).toFixed(2)}</p>
        </div>

        <Card className="rounded-3xl border-0 shadow-2xl">
          <CardContent className="p-6 space-y-5">
            {/* QR Code */}
            <div className="flex flex-col items-center gap-3">
              <div className="bg-surface p-5 rounded-2xl border border-border">
                <QRCodeSVG value={claimUrl} size={220} fgColor="hsl(var(--brand))" level="H" includeMargin={false} />
              </div>
              <p className="text-muted-foreground font-semibold text-sm text-center">Have everyone scan this 📱</p>
            </div>

            {/* Link */}
            <div className="flex gap-2 items-center bg-surface rounded-xl p-3 border border-border">
              <span className="text-xs text-muted-foreground font-mono flex-1 truncate">{claimUrl}</span>
              <Button size="sm" variant="outline" onClick={copyLink} className="rounded-lg shrink-0 h-7 px-3">
                {copied
                  ? <><Check className="w-3 h-3 text-success mr-1" aria-hidden="true" /><span className="text-xs text-success">Copied!</span></>
                  : <><Copy className="w-3 h-3 mr-1" aria-hidden="true" /><span className="text-xs">Copy</span></>
                }
              </Button>
            </div>

            {/* Live Participants */}
            <div className="flex items-center justify-between bg-brand-muted rounded-xl p-3">
              <div className="flex items-center gap-2 text-brand-muted-foreground font-semibold text-sm">
                <Users className="w-4 h-4" aria-hidden="true" />
                {participants.length === 0 ? "Waiting for guests…" : `${participants.length} joined`}
              </div>
              <div className="flex gap-1">
                {participants.slice(0, 6).map((p, i) => (
                  <div key={i} aria-label={p.name || "Guest"} className="w-7 h-7 bg-brand text-brand-foreground rounded-full flex items-center justify-center text-xs font-bold shadow-sm">
                    {(p.name || "?")[0].toUpperCase()}
                  </div>
                ))}
                {participants.length > 6 && (
                  <div className="w-7 h-7 bg-muted text-muted-foreground rounded-full flex items-center justify-center text-xs">+{participants.length - 6}</div>
                )}
              </div>
            </div>

            {/* Progress */}
            {session.status === "claiming" && totalItems > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Items claimed</span><span>{claimedItems}/{totalItems}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="bg-brand h-2 rounded-full transition-all" style={{ width: `${(claimedItems / totalItems) * 100}%` }} />
                </div>
              </div>
            )}

            {/* Primary CTA */}
            <Button
              onClick={startClaiming}
              className="w-full bg-brand hover:bg-brand/90 text-brand-foreground font-bold rounded-xl h-12 text-base shadow-lg"
            >
              {session.status === "claiming" ? "View Progress" : "Claim My Items"} <ArrowRight className="ml-2 w-4 h-4" aria-hidden="true" />
            </Button>

            {/* Share Options */}
            <div>
              <p className="text-center text-xs text-muted-foreground mb-3">Or share via</p>
              <div className="flex gap-2 justify-center">
                <Button size="sm" variant="outline" onClick={shareViaText} className="rounded-xl flex-1 text-xs">
                  <MessageSquare className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Text
                </Button>
                <Button size="sm" variant="outline" onClick={shareViaEmail} className="rounded-xl flex-1 text-xs">
                  <Mail className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Email
                </Button>
                <Button size="sm" variant="outline" onClick={shareNative} className="rounded-xl flex-1 text-xs">
                  <Share2 className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> More
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
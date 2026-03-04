import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, Users, ArrowRight, MessageSquare, Mail, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function SessionHost() {
  const navigate = useNavigate();
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
    // Poll every 3 seconds for new participants
    const interval = setInterval(fetchSession, 3000);
    return () => clearInterval(interval);
  }, [fetchSession]);

  // Real-time subscription
  useEffect(() => {
    if (!sessionId) return;
    const unsub = base44.entities.Session.subscribe((event) => {
      if (event.id === sessionId && event.data) {
        setSession(event.data);
      }
    });
    return unsub;
  }, [sessionId]);

  const copyLink = () => {
    navigator.clipboard.writeText(claimUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startClaiming = async () => {
    await base44.entities.Session.update(sessionId, { status: "claiming" });
    navigate(createPageUrl(`ReceiptDetail?id=${sessionId}&host=1`));
  };

  if (!session) return (
    <div className="min-h-screen flex items-center justify-center text-gray-400">
      <div className="text-center">Loading session...</div>
    </div>
  );

  const participants = session.participants || [];
  const totalItems = (session.items || []).length;
  const claimedItems = (session.items || []).filter(i => (i.claimed_by || []).length > 0).length;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-4">
        <div className="text-center">
          <div className="text-3xl mb-1">🎉</div>
          <h1 className="text-2xl font-black text-gray-900">Your bill is ready!</h1>
          <p className="text-gray-500 mt-1 text-sm">{session.title} · ${(session.total_amount || 0).toFixed(2)}</p>
        </div>

        <Card className="rounded-3xl border-0 shadow-lg">
          <CardContent className="p-6 space-y-4">
            {/* QR Code */}
            <div className="flex flex-col items-center gap-3">
              <div className="bg-white p-4 rounded-2xl shadow-inner border border-gray-100">
                <QRCodeSVG value={claimUrl} size={200} fgColor="#7c3aed" />
              </div>
              <p className="text-gray-600 font-semibold text-sm text-center">Have everyone scan this 📱</p>
            </div>

            {/* Link */}
            <div className="flex gap-2 items-center bg-gray-50 rounded-xl p-3">
              <span className="text-xs text-gray-500 flex-1 truncate">{claimUrl}</span>
              <Button size="sm" variant="outline" onClick={copyLink} className="rounded-lg shrink-0">
                {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </Button>
            </div>

            {/* Participants */}
            <div className="flex items-center justify-between bg-purple-50 rounded-xl p-3">
              <div className="flex items-center gap-2 text-purple-700 font-semibold text-sm">
                <Users className="w-4 h-4" />
                Joined: {participants.length}
              </div>
              <div className="flex gap-1">
                {participants.slice(0, 5).map((p, i) => (
                  <div key={i} className="w-7 h-7 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                    {(p.name || "?")[0].toUpperCase()}
                  </div>
                ))}
                {participants.length > 5 && (
                  <div className="w-7 h-7 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center text-xs">
                    +{participants.length - 5}
                  </div>
                )}
              </div>
            </div>

            {/* Progress (if claiming started) */}
            {session.status === "claiming" && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{claimedItems}/{totalItems} items claimed</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-purple-600 h-2 rounded-full transition-all"
                    style={{ width: `${totalItems > 0 ? (claimedItems / totalItems) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            <Button
              onClick={startClaiming}
              className="w-full bg-purple-600 hover:bg-purple-700 font-bold rounded-xl h-12"
            >
              {session.status === "claiming" ? "View Progress" : "Start Claiming"} <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
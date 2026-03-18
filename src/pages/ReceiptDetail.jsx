import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { CheckCircle2, Clock, Users, Receipt, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AppHeader from "@/components/AppHeader";

const statusColors = {
  unpaid: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  paid: "bg-green-100 text-green-700",
};

export default function ReceiptDetail() {
  const navigate = useNavigate();
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

  // Real-time subscription
  useEffect(() => {
    if (!sessionId) return;
    const unsub = base44.entities.Session.subscribe((event) => {
      if (event.id === sessionId && event.data) setSession(event.data);
    });
    return unsub;
  }, [sessionId]);

  const markAsPaid = async (participantId) => {
    const updatedParticipants = session.participants.map(p =>
      p.participant_id === participantId ? { ...p, payment_status: "paid" } : p
    );
    const allPaid = updatedParticipants.every(p => p.payment_status === "paid");
    const updated = await base44.entities.Session.update(session.id, {
      participants: updatedParticipants,
      status: allPaid ? "completed" : "claiming",
    });
    setSession(updated);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;
  if (!session) return <div className="min-h-screen flex items-center justify-center text-gray-500">Session not found.</div>;

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
      onClick={() => navigate(createPageUrl(`SessionHost?id=${sessionId}`))}
      className="w-11 h-11 flex items-center justify-center rounded-xl text-purple-600 active:bg-purple-50"
      aria-label="Show QR"
    >
      <QrCode className="w-5 h-5" />
    </button>
  ) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title={session.title} backTo={createPageUrl("Dashboard")} rightAction={rightAction} />
      <div className="max-w-2xl mx-auto p-5 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mt-0 text-gray-500 text-sm flex-wrap">
              <span className="flex items-center gap-1"><Users className="w-4 h-4" /> {total} people</span>
              <span className="flex items-center gap-1"><Receipt className="w-4 h-4" /> ${(session.total_amount || 0).toFixed(2)} total</span>
              <span className="font-semibold text-green-600">{paid}/{total} paid</span>
              <span className="text-gray-400">{claimedCount}/{items.length} items claimed</span>
            </div>
          </div>
          <div>
            <Badge className={session.status === "completed" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}>
              {session.status}
            </Badge>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Items claimed</span><span>{claimedCount}/{items.length}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-purple-600 h-2 rounded-full transition-all" style={{ width: `${items.length > 0 ? (claimedCount / items.length) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Image */}
        {session.image_url && (
          <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
            <img src={session.image_url} alt="Receipt" className="w-full max-h-64 object-contain bg-gray-100" />
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
                      <span className="text-gray-700">{item.quantity > 1 ? `${item.quantity}× ` : ""}{item.name}</span>
                      {claimed.length > 0 && (
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {claimed.map(pid => (
                            <span key={pid} className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">👤 {getName(pid)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="font-semibold text-gray-900">${(item.price * (item.quantity || 1)).toFixed(2)}</span>
                  </div>
                );
              })}
              {session.tax > 0 && (
                <div className="flex justify-between text-sm text-gray-500 pt-1 border-t">
                  <span>Tax</span><span>${session.tax.toFixed(2)}</span>
                </div>
              )}
              {session.tip > 0 && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Tip</span><span>${session.tip.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-base pt-2 border-t">
                <span>Total</span><span className="text-purple-700">${(session.total_amount || 0).toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Participants */}
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardHeader className="pb-2 pt-5 px-5"><CardTitle className="text-base">Who owes what</CardTitle></CardHeader>
          <CardContent className="px-5 pb-5 space-y-3">
            {participants.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-3">No one has joined yet. Share the QR code!</p>
            ) : participants.map((p) => (
              <div key={p.participant_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <div>
                  <div className="font-semibold text-gray-900">{p.name}</div>
                  <div className="text-purple-700 font-black text-lg mt-0.5">${(p.amount_owed || 0).toFixed(2)}</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge className={statusColors[p.payment_status] || statusColors.unpaid}>
                    {p.payment_status === "paid" ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                    {p.payment_status}
                  </Badge>
                  {p.payment_status !== "paid" && isHost && (
                    <Button size="sm" onClick={() => markAsPaid(p.participant_id)} className="h-11 text-sm px-4 bg-green-600 hover:bg-green-700 rounded-xl">
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
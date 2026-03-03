import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Plus, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

function calcMyShare(items, myId, tax, tip) {
  const subtotal = items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
  let mySubtotal = 0;
  items.forEach(item => {
    const claimed = item.claimed_by || [];
    if (claimed.includes(myId)) {
      mySubtotal += (item.price * (item.quantity || 1)) / claimed.length;
    }
  });
  if (subtotal === 0) return mySubtotal;
  const ratio = mySubtotal / subtotal;
  return mySubtotal + (tax || 0) * ratio + (tip || 0) * ratio;
}

export default function Claim() {
  const sessionId = new URLSearchParams(window.location.search).get("id");
  const [session, setSession] = useState(null);
  const [myId] = useState(() => {
    let id = localStorage.getItem("divvy_participant_id");
    if (!id) { id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; localStorage.setItem("divvy_participant_id", id); }
    return id;
  });
  const [myName, setMyName] = useState(() => localStorage.getItem("divvy_participant_name") || "");
  const [nameInput, setNameInput] = useState(() => localStorage.getItem("divvy_participant_name") || "");
  const [loading, setLoading] = useState(true);
  const [addingItem, setAddingItem] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    const data = await base44.entities.Session.filter({ id: sessionId });
    if (data[0]) {
      setSession(data[0]);
      const existing = (data[0].participants || []).find(p => p.participant_id === myId);
      if (existing && existing.name) setMyName(existing.name);
    }
    setLoading(false);
  }, [sessionId, myId]);

  useEffect(() => { fetchSession(); }, [fetchSession]);

  // Real-time subscription
  useEffect(() => {
    if (!sessionId) return;
    const unsub = base44.entities.Session.subscribe((event) => {
      if (event.id === sessionId && event.data) setSession(event.data);
    });
    return unsub;
  }, [sessionId]);

  // Register/update participant (called on name change or on first claim)
  const ensureJoined = async (name) => {
    const current = await base44.entities.Session.filter({ id: sessionId });
    const s = current[0];
    if (!s) return;
    const alreadyIn = (s.participants || []).find(p => p.participant_id === myId);
    if (!alreadyIn) {
      await base44.entities.Session.update(sessionId, {
        participants: [...(s.participants || []), { participant_id: myId, name: name || "Anonymous", amount_owed: 0, payment_status: "unpaid" }],
        status: s.status === "waiting" ? "claiming" : s.status
      });
    } else if (name && alreadyIn.name !== name) {
      const updatedParticipants = (s.participants || []).map(p =>
        p.participant_id === myId ? { ...p, name } : p
      );
      await base44.entities.Session.update(sessionId, { participants: updatedParticipants });
    }
  };

  const handleNameBlur = async () => {
    const name = nameInput.trim();
    if (name !== myName) {
      localStorage.setItem("divvy_participant_name", name);
      setMyName(name);
      await ensureJoined(name);
    }
  };

  const toggleClaim = async (itemId) => {
    if (!session) return;
    // Auto-join on first claim if not yet registered
    await ensureJoined(nameInput.trim() || myName || "Anonymous");
    const updatedItems = session.items.map(item => {
      if (item.id !== itemId) return item;
      const claimed = item.claimed_by || [];
      const already = claimed.includes(myId);
      return { ...item, claimed_by: already ? claimed.filter(id => id !== myId) : [...claimed, myId] };
    });

    // Recalculate amounts for all participants
    const participants = session.participants || [];
    const updatedParticipants = participants.map(p => ({
      ...p,
      amount_owed: Math.round(calcMyShare(updatedItems, p.participant_id, session.tax, session.tip) * 100) / 100
    }));

    const updated = await base44.entities.Session.update(sessionId, { items: updatedItems, participants: updatedParticipants });
    setSession(updated);
  };

  const handleAddItem = async () => {
    if (!newItemName.trim() || !newItemPrice) return;
    const newItem = { id: `item-${Date.now()}`, name: newItemName.trim(), price: parseFloat(newItemPrice) || 0, quantity: 1, claimed_by: [] };
    const updatedItems = [...(session.items || []), newItem];
    const subtotal = updatedItems.reduce((s, i) => s + (i.price * (i.quantity || 1)), 0);
    const total = subtotal + (session.tax || 0) + (session.tip || 0);
    const updated = await base44.entities.Session.update(sessionId, { items: updatedItems, total_amount: total });
    setSession(updated);
    setNewItemName(""); setNewItemPrice(""); setAddingItem(false);
  };

  const markMePaid = async () => {
    const updatedParticipants = (session.participants || []).map(p =>
      p.participant_id === myId ? { ...p, payment_status: "paid" } : p
    );
    const allPaid = updatedParticipants.every(p => p.payment_status === "paid");
    const updated = await base44.entities.Session.update(sessionId, {
      participants: updatedParticipants,
      status: allPaid ? "completed" : session.status
    });
    setSession(updated);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
    </div>
  );

  if (!session) return (
    <div className="min-h-screen flex items-center justify-center text-gray-500">Session not found.</div>
  );

  const items = session.items || [];
  const participants = session.participants || [];
  const claimedCount = items.filter(i => (i.claimed_by || []).length > 0).length;
  const myShare = calcMyShare(items, myId, session.tax, session.tip);
  const myMyClaimed = items.filter(i => (i.claimed_by || []).includes(myId));
  const meParticipant = participants.find(p => p.participant_id === myId);
  const alreadyPaid = meParticipant?.payment_status === "paid";

  // Lookup name by participant_id
  const getName = (pid) => {
    if (pid === myId) return "You";
    const p = participants.find(x => x.participant_id === pid);
    return p ? p.name : "Someone";
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* Header */}
      <div className="bg-white border-b px-5 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-black text-gray-900">{session.title}</h1>
              <p className="text-xs text-gray-400">Tap what you ordered 👆</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400">{claimedCount}/{items.length} claimed</div>
              <div className="w-24 bg-gray-200 rounded-full h-1.5 mt-1">
                <div className="bg-purple-600 h-1.5 rounded-full transition-all" style={{ width: `${items.length > 0 ? (claimedCount / items.length) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-2">
        {items.map(item => {
          const claimed = item.claimed_by || [];
          const isMine = claimed.includes(myId);
          const itemTotal = item.price * (item.quantity || 1);
          const myCost = isMine ? itemTotal / claimed.length : 0;

          return (
            <button
              key={item.id}
              onClick={() => toggleClaim(item.id)}
              className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${
                isMine
                  ? "bg-purple-50 border-purple-400"
                  : claimed.length > 0
                  ? "bg-gray-50 border-gray-100 opacity-60"
                  : "bg-white border-gray-200 hover:border-purple-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${isMine ? "bg-purple-600 border-purple-600" : "border-gray-300"}`}>
                    {isMine && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div>
                    <div className={`font-semibold ${isMine ? "text-purple-900" : "text-gray-700"}`}>
                      {item.quantity > 1 ? `${item.quantity}× ` : ""}{item.name}
                    </div>
                    {claimed.length > 0 && (
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {claimed.map(pid => (
                          <span key={pid} className={`text-xs px-1.5 py-0.5 rounded-full ${pid === myId ? "bg-purple-200 text-purple-800" : "bg-gray-200 text-gray-600"}`}>
                            👤 {getName(pid)}
                          </span>
                        ))}
                        {claimed.length > 1 && <span className="text-xs text-gray-400">÷{claimed.length}</span>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="font-bold text-gray-900">${itemTotal.toFixed(2)}</div>
                  {isMine && claimed.length > 1 && (
                    <div className="text-xs text-purple-600 font-semibold">You: ${myCost.toFixed(2)}</div>
                  )}
                </div>
              </div>
            </button>
          );
        })}

        {/* Add item */}
        {!addingItem ? (
          <button
            onClick={() => setAddingItem(true)}
            className="w-full p-3 rounded-2xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-purple-300 hover:text-purple-500 transition-all text-sm font-medium flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add missing item
          </button>
        ) : (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="flex gap-2">
                <Input value={newItemName} onChange={e => setNewItemName(e.target.value)} placeholder="Item name" className="flex-1 rounded-xl text-sm" autoFocus />
                <Input type="number" value={newItemPrice} onChange={e => setNewItemPrice(e.target.value)} placeholder="$0.00" className="w-20 rounded-xl text-sm" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddItem} className="flex-1 bg-purple-600 hover:bg-purple-700 rounded-xl">Add</Button>
                <Button size="sm" variant="outline" onClick={() => setAddingItem(false)} className="rounded-xl">Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Who else is claiming */}
        {participants.length > 1 && (
          <div className="pt-2">
            <p className="text-xs text-gray-400 font-medium mb-2">In this split:</p>
            <div className="flex gap-2 flex-wrap">
              {participants.map(p => (
                <div key={p.participant_id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${p.participant_id === myId ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"}`}>
                  <div className="w-4 h-4 rounded-full bg-current opacity-60 flex items-center justify-center text-white text-[8px]">
                    {(p.name || "?")[0].toUpperCase()}
                  </div>
                  {p.participant_id === myId ? "You" : p.name}
                  {p.payment_status === "paid" && " ✓"}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-xl p-4">
        <div className="max-w-lg mx-auto space-y-3">
          {myMyClaimed.length > 0 ? (
            <div className="flex justify-between items-center text-sm">
              <div>
                <div className="font-bold text-gray-900">Your share</div>
                <div className="text-xs text-gray-400">{myMyClaimed.length} item{myMyClaimed.length !== 1 ? "s" : ""} + tax & tip</div>
              </div>
              <div className="text-2xl font-black text-purple-700">${myShare.toFixed(2)}</div>
            </div>
          ) : (
            <p className="text-center text-gray-400 text-sm">Tap items above to claim them</p>
          )}
          <Button
            onClick={markMePaid}
            disabled={myMyClaimed.length === 0 || alreadyPaid}
            className={`w-full font-bold rounded-xl h-12 text-base ${alreadyPaid ? "bg-green-600 hover:bg-green-600" : "bg-purple-600 hover:bg-purple-700"}`}
          >
            {alreadyPaid ? "✓ Marked as Paid" : myMyClaimed.length > 0 ? `Pay $${myShare.toFixed(2)}` : "Claim items to pay"}
          </Button>
        </div>
      </div>
    </div>
  );
}
import { useState, useEffect, useCallback, memo } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Plus, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { dispatchMutationError } from "@/components/MutationErrorToast";

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

const Claim = memo(function Claim() {
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

  useEffect(() => {
    if (!sessionId) return;
    const unsub = base44.entities.Session.subscribe((event) => {
      if (event.id === sessionId && event.data) setSession(event.data);
    });
    return unsub;
  }, [sessionId]);

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

  const claimMutation = useMutation({
    mutationFn: async ({ optimisticItems, optimisticParticipants }) => {
      await ensureJoined(nameInput.trim() || myName || "Anonymous");
      return base44.entities.Session.update(sessionId, { items: optimisticItems, participants: optimisticParticipants });
    },
    onMutate: ({ optimisticItems, optimisticParticipants }) => {
      const snapshot = session;
      setSession(prev => ({ ...prev, items: optimisticItems, participants: optimisticParticipants }));
      return snapshot;
    },
    onError: (err, _vars, snapshot) => { setSession(snapshot); dispatchMutationError(err); },
    onSuccess: (updated) => { setSession(updated); },
  });

  const toggleClaim = (itemId) => {
    if (!session) return;
    const optimisticItems = session.items.map(item => {
      if (item.id !== itemId) return item;
      const claimed = item.claimed_by || [];
      const already = claimed.includes(myId);
      return { ...item, claimed_by: already ? claimed.filter(id => id !== myId) : [...claimed, myId] };
    });
    const optimisticParticipants = (session.participants || []).map(p => ({
      ...p,
      amount_owed: Math.round(calcMyShare(optimisticItems, p.participant_id, session.tax, session.tip) * 100) / 100
    }));
    claimMutation.mutate({ optimisticItems, optimisticParticipants });
  };

  const addItemMutation = useMutation({
    mutationFn: ({ updatedItems, total }) =>
      base44.entities.Session.update(sessionId, { items: updatedItems, total_amount: total }),
    onMutate: ({ updatedItems, total }) => {
      const snapshot = session;
      setSession(prev => ({ ...prev, items: updatedItems, total_amount: total }));
      return snapshot;
    },
    onError: (err, _vars, snapshot) => { setSession(snapshot); dispatchMutationError(err); },
    onSuccess: (updated) => { setSession(updated); },
  });

  const handleAddItem = () => {
    if (!newItemName.trim() || !newItemPrice) return;
    const newItem = { id: `item-${Date.now()}`, name: newItemName.trim(), price: parseFloat(newItemPrice) || 0, quantity: 1, claimed_by: [] };
    const updatedItems = [...(session.items || []), newItem];
    const subtotal = updatedItems.reduce((s, i) => s + (i.price * (i.quantity || 1)), 0);
    const total = subtotal + (session.tax || 0) + (session.tip || 0);
    addItemMutation.mutate({ updatedItems, total });
    setNewItemName(""); setNewItemPrice(""); setAddingItem(false);
  };

  const paidMutation = useMutation({
    mutationFn: ({ updatedParticipants, newStatus }) =>
      base44.entities.Session.update(sessionId, { participants: updatedParticipants, status: newStatus }),
    onMutate: ({ updatedParticipants, newStatus }) => {
      const snapshot = session;
      setSession(prev => ({ ...prev, participants: updatedParticipants, status: newStatus }));
      return snapshot;
    },
    onError: (err, _vars, snapshot) => { setSession(snapshot); dispatchMutationError(err); },
    onSuccess: (updated) => { setSession(updated); },
  });

  const markMePaid = () => {
    const updatedParticipants = (session.participants || []).map(p =>
      p.participant_id === myId ? { ...p, payment_status: "paid" } : p
    );
    const allPaid = updatedParticipants.every(p => p.payment_status === "paid");
    paidMutation.mutate({ updatedParticipants, newStatus: allPaid ? "completed" : session.status });
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
      <Loader2 className="w-8 h-8 animate-spin text-brand" aria-label="Loading session" />
    </div>
  );

  if (!session) return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">Session not found.</div>
  );

  const items = session.items || [];
  const participants = session.participants || [];
  const claimedCount = items.filter(i => (i.claimed_by || []).length > 0).length;
  const myShare = calcMyShare(items, myId, session.tax, session.tip);
  const myMyClaimed = items.filter(i => (i.claimed_by || []).includes(myId));
  const meParticipant = participants.find(p => p.participant_id === myId);
  const alreadyPaid = meParticipant?.payment_status === "paid";

  const getName = (pid) => {
    if (pid === myId) return "You";
    const p = participants.find(x => x.participant_id === pid);
    return p ? p.name : "Someone";
  };

  return (
    <div className="min-h-screen bg-surface" style={{ paddingBottom: "calc(8rem + env(safe-area-inset-bottom))" }}>
      {/* Header */}
      <div className="bg-surface-raised border-b border-border px-5 py-3 sticky top-0 z-10">
        <div className="max-w-lg mx-auto space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-black text-foreground">{session.title}</h1>
              <p className="text-xs text-muted-foreground">Tap what you ordered 👆</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">{claimedCount}/{items.length} claimed</div>
              <div
                role="progressbar"
                aria-valuenow={claimedCount}
                aria-valuemin={0}
                aria-valuemax={items.length}
                aria-label="Items claimed"
                className="w-24 bg-muted rounded-full h-1.5 mt-1"
              >
                <div className="bg-brand h-1.5 rounded-full transition-all" style={{ width: `${items.length > 0 ? (claimedCount / items.length) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="participant-name" className="text-xs text-muted-foreground shrink-0">Your name:</label>
            <input
              id="participant-name"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={e => e.key === "Enter" && e.target.blur()}
              placeholder="optional"
              autoComplete="nickname"
              className="flex-1 h-9 rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring text-foreground"
            />
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
              aria-label={`${isMine ? "Unclaim" : "Claim"} ${item.name}`}
              aria-pressed={isMine}
              className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${
                isMine
                  ? "bg-brand-muted border-brand"
                  : claimed.length > 0
                  ? "bg-surface border-border opacity-60"
                  : "bg-surface-raised border-border hover:border-brand/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${isMine ? "bg-brand border-brand" : "border-muted-foreground/40"}`}>
                    {isMine && <Check className="w-3 h-3 text-brand-foreground" aria-hidden="true" />}
                  </div>
                  <div>
                    <div className={`font-semibold ${isMine ? "text-brand-muted-foreground" : "text-foreground"}`}>
                      {item.quantity > 1 ? `${item.quantity}× ` : ""}{item.name}
                    </div>
                    {claimed.length > 0 && (
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {claimed.map(pid => (
                          <span key={pid} className={`text-xs px-1.5 py-0.5 rounded-full ${pid === myId ? "bg-brand-muted text-brand-muted-foreground" : "bg-muted text-muted-foreground"}`}>
                            👤 {getName(pid)}
                          </span>
                        ))}
                        {claimed.length > 1 && <span className="text-xs text-muted-foreground">÷{claimed.length}</span>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="font-bold text-foreground">${itemTotal.toFixed(2)}</div>
                  {isMine && claimed.length > 1 && (
                    <div className="text-xs text-brand font-semibold">You: ${myCost.toFixed(2)}</div>
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
            aria-label="Add a missing item to the bill"
            className="w-full p-3 rounded-2xl border-2 border-dashed border-border text-muted-foreground hover:border-brand/50 hover:text-brand transition-all text-sm font-medium flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> Add missing item
          </button>
        ) : (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="flex gap-2">
                <Input
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                  placeholder="Item name"
                  aria-label="New item name"
                  className="flex-1 rounded-xl text-sm"
                  autoFocus
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  value={newItemPrice}
                  onChange={e => setNewItemPrice(e.target.value)}
                  placeholder="$0.00"
                  aria-label="New item price"
                  className="w-20 rounded-xl text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddItem} className="flex-1 bg-brand hover:bg-brand/90 text-brand-foreground rounded-xl">Add</Button>
                <Button size="sm" variant="outline" onClick={() => setAddingItem(false)} className="rounded-xl">Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Who else is claiming */}
        {participants.length > 1 && (
          <div className="pt-2">
            <p className="text-xs text-muted-foreground font-medium mb-2">In this split:</p>
            <div className="flex gap-2 flex-wrap">
              {participants.map(p => (
                <div key={p.participant_id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${p.participant_id === myId ? "bg-brand-muted text-brand-muted-foreground" : "bg-muted text-muted-foreground"}`}>
                  <div className="w-4 h-4 rounded-full bg-current opacity-60 flex items-center justify-center text-[8px]">
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
      <div
        role="region"
        aria-label="Your bill summary"
        className="fixed bottom-0 left-0 right-0 bg-surface-raised border-t border-border shadow-xl p-4"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <div className="max-w-lg mx-auto space-y-3">
          {myMyClaimed.length > 0 ? (
            <div className="flex justify-between items-center text-sm">
              <div>
                <div className="font-bold text-foreground">Your share</div>
                <div className="text-xs text-muted-foreground">{myMyClaimed.length} item{myMyClaimed.length !== 1 ? "s" : ""} + tax &amp; tip</div>
              </div>
              <div className="text-2xl font-black text-brand">${myShare.toFixed(2)}</div>
            </div>
          ) : (
            <p className="text-center text-muted-foreground text-sm">Tap items above to claim them</p>
          )}
          <Button
            onClick={markMePaid}
            disabled={myMyClaimed.length === 0 || alreadyPaid}
            className={`w-full font-bold rounded-xl h-12 text-base ${alreadyPaid ? "bg-success hover:bg-success text-success-muted-foreground" : "bg-brand hover:bg-brand/90 text-brand-foreground"}`}
          >
            {alreadyPaid ? "✓ Marked as Paid" : myMyClaimed.length > 0 ? `Pay $${myShare.toFixed(2)}` : "Claim items to pay"}
          </Button>
        </div>
      </div>
    </div>
  );
}
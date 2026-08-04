import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { invoke } from "@/api/functions";
import { useNavigate } from "react-router-dom";
import { Plus, Receipt, CheckCircle2, Clock, Users, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSaveScroll } from "@/hooks/useTabHistory";
import { useAuth } from "@/lib/AuthContext";
import ListLayout from "@/components/ListLayout";
import { listSplits, rememberSplit } from "@/lib/splitHistory";
import { getHostKey } from "@/lib/hostKey";
import DashboardSkeleton from "@/components/DashboardSkeleton";
import { sessionPath } from '@/lib/sessionLinks';

const statusConfig = {
  waiting:   { label: "Waiting",     cls: "bg-amber-500/15 text-amber-400 border border-amber-500/20" },
  claiming:  { label: "In Progress", cls: "bg-blue-500/15 text-blue-400 border border-blue-500/20" },
  completed: { label: "Done",        cls: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" },
};

const SessionCard = memo(function SessionCard({ session, onClick }) {
  const paid  = (session.participants || []).filter(p => p.payment_status === "paid").length;
  const total = (session.participants || []).length;
  const { label, cls } = statusConfig[session.status] || statusConfig.waiting;

  return (
    <button
      onClick={onClick}
      aria-label={`${session.title}: $${(session.total_amount || 0).toFixed(2)} - ${paid} of ${total} paid`}
      className="w-full text-left rounded-2xl p-4 flex items-center justify-between transition-all"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
      onMouseEnter={e => e.currentTarget.style.border = '1px solid rgba(255,255,255,0.15)'}
      onMouseLeave={e => e.currentTarget.style.border = '1px solid rgba(255,255,255,0.07)'}
    >
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shrink-0">
          <Receipt className="w-5 h-5 text-white" aria-hidden="true" />
        </div>
        <div>
          <div className="font-bold text-foreground text-base">{session.title}</div>
          <div className="text-sm text-muted-foreground flex items-center gap-2 mt-0.5">
            <Users className="w-3.5 h-3.5" aria-hidden="true" />
            {total} people ·{' '}
            <span className="text-brand font-semibold">${(session.total_amount || 0).toFixed(2)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-right">
          <div className="text-xs text-muted-foreground mb-1">{paid}/{total} paid</div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${cls}`}>{label}</span>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground ml-1" aria-hidden="true" />
      </div>
    </button>
  );
});

/** How many recent splits a guest's history re-reads from the server on open. */
const HYDRATE_LIMIT = 8;

export default function Dashboard() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const { ref: scrollRef, onScroll, restoreScroll } = useSaveScroll("dashboard");
  const navigate = useNavigate();
  const { isAuthenticated, isLoadingAuth } = useAuth();

  const myId = useMemo(() => {
    try { return localStorage.getItem("billtap_participant_id"); } catch { return null; }
  }, []);

  /**
   * One history, from the device.
   *
   * A signed-in operator used to get theirs from a Base44 entity list that knew
   * what they owned. Nothing serves that now: there is no "my sessions"
   * endpoint on the Worker, and adding one is a change to the data layer rather
   * than to this screen. What is left is the local index in
   * src/lib/splitHistory.js, which is what a guest has always used — this
   * screen used to answer them by replacing the page with the landing page, so
   * the product's primary user could not see a single bill they had ever split.
   *
   * The cost, stated plainly: an operator who split a bill on another device no
   * longer sees it here. It is a real loss and it needs a Worker endpoint that
   * lists sessions by owner to undo.
   *
   * The cached summary paints first so the list is there instantly, then the
   * most recent few are re-read from the server so the paid counts are real
   * rather than whatever was true when the tab last closed.
   */
  const fetchSessions = useCallback(async () => {
    const local = listSplits();
    setSessions(local.map((e) => ({
      id: e.id,
      title: e.title || "Split",
      total_amount: e.total,
      status: e.status || "claiming",
      __role: e.role,
      // Enough for the card to draw a truthful "2/5 paid" before the network
      // answers, rather than flashing 0 of 0 at everybody.
      participants: Array.from({ length: e.participants || 0 }, (_, i) => ({
        participant_id: `cached_${i}`,
        payment_status: i < (e.paid || 0) ? "paid" : "unpaid",
      })),
    })));
    setLoading(false);
    setTimeout(restoreScroll, 50);

    const fresh = await Promise.all(local.slice(0, HYDRATE_LIMIT).map(async (entry) => {
      try {
        const hostKey = getHostKey(entry.id);
        const res = hostKey
          ? await invoke("getSessionAsHost", { session_id: entry.id, host_key: hostKey })
          : await invoke("getSplitStatus", { session_id: entry.id, participant_id: myId });
        const session = res?.data?.session;
        if (!session) return null;
        rememberSplit({
          id: session.id, title: session.title, total: session.total_amount, status: session.status,
          participants: (session.participants || []).length,
          paid: (session.participants || []).filter((p) => p.payment_status === "paid").length,
        });
        return { ...session, __role: entry.role };
      } catch {
        // A split the server has dropped, or a flaky connection. The cached row
        // stays; it is better than a list that empties itself on one bad poll.
        return null;
      }
    }));

    const byId = new Map(fresh.filter(Boolean).map((s) => [s.id, s]));
    if (byId.size) setSessions((prev) => prev.map((s) => byId.get(s.id) || s));
  }, [myId, restoreScroll]);

  useEffect(() => { if (!isLoadingAuth) fetchSessions(); }, [fetchSessions, isLoadingAuth]);

  // There was a Session.subscribe() here. It was Base44 realtime, it only ever
  // delivered to a signed-in owner, and the list is refreshed on open and on
  // pull-to-refresh instead — which is what a guest has always had.

  /**
   * A host is owed money; a diner owes it. The old figures summed every
   * participant's amount_owed, which for a guest is a column they cannot see —
   * the scoped read returns their own share and withholds everyone else's — so
   * the cards would have read $0.00 and $0.00 for exactly the person looking.
   */
  const { totalOwed, totalCollected } = useMemo(() => {
    // Whether this device holds the host key, not whether anyone is signed in.
    // Being signed in used to imply the whole row, because the list came from an
    // owner-scoped entity read; it comes from getSessionAsHost or
    // getSplitStatus now, and which of those answered is decided by the host
    // key. A signed-in operator looking at a split they merely ate at gets the
    // scoped view like everybody else, and summing it as though they owned it
    // would show them somebody else's money.
    const mine = (s) => (s.participants || []).filter(p =>
      s.__role === "host" ? true : p.participant_id === myId);
    return {
      totalOwed: sessions.reduce((sum, s) =>
        sum + mine(s).filter(p => p.payment_status !== "paid").reduce((a, p) => a + (p.amount_owed || 0), 0), 0),
      totalCollected: sessions.reduce((sum, s) =>
        sum + mine(s).filter(p => p.payment_status === "paid").reduce((a, p) => a + (p.paid_amount ?? p.amount_owed ?? 0), 0), 0),
    };
  }, [sessions, myId]);

  const statCards = [
    { label: "Bills Split", value: sessions.length, icon: Receipt, color: "from-violet-500 to-purple-600" },
    { label: isAuthenticated ? "Outstanding" : "You owe", value: `$${totalOwed.toFixed(2)}`, icon: Clock, color: "from-amber-400 to-orange-400" },
    { label: isAuthenticated ? "Collected" : "You paid", value: `$${totalCollected.toFixed(2)}`, icon: CheckCircle2, color: "from-emerald-400 to-teal-500" },
  ];

  return (
    <>
      {loading && <DashboardSkeleton />}
      {!loading && (
        <ListLayout onRefresh={fetchSessions}>
          <div ref={scrollRef} onScroll={onScroll} className="max-w-4xl mx-auto px-5 space-y-5 pb-28 pt-5">

            {/* Page header */}
            <div className="flex items-center justify-between pt-1">
              <div>
                <h1 className="text-2xl font-black text-foreground tracking-tight">Your Bills</h1>
                <p className="text-muted-foreground text-sm mt-0.5">
                  {"Splits from this phone"}
                </p>
              </div>
              <button
                onClick={() => navigate("/new-receipt")}
                aria-label="Create new bill split"
                className="flex items-center gap-2 px-4 h-11 text-white font-bold rounded-xl text-sm shadow-lg transition-all hover:-translate-y-0.5 active:translate-y-0"
                style={{ background: 'linear-gradient(135deg, #f5576c, #f093fb)' }}
              >
                <Plus className="w-4 h-4" aria-hidden="true" /> New Split
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              {statCards.map(({ label, value, icon: Icon, color }) => (
                <div
                  key={label}
                  className="rounded-2xl p-4"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                  aria-label={`${label}: ${value}`}
                >
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-3`}>
                    <Icon className="w-4 h-4 text-white" aria-hidden="true" />
                  </div>
                  <div className="text-xl font-black text-foreground">{value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {/* Sessions list */}
            {sessions.length === 0 ? (
              <div
                className="text-center py-16 rounded-2xl"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mx-auto mb-4">
                  <Receipt className="w-8 h-8 text-white" aria-hidden="true" />
                </div>
                <h2 className="text-xl font-bold text-foreground mb-2">No bills yet</h2>
                <p className="text-muted-foreground text-sm mb-6 max-w-xs mx-auto">
                  Snap a receipt and split it with your table in 30 seconds.
                </p>
                <Button
                  onClick={() => navigate("/new-receipt")}
                  className="bg-brand hover:bg-brand/90 text-brand-foreground font-bold rounded-xl"
                >
                  Split your first bill
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-foreground">All Splits</h2>
                {sessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onClick={() => navigate(
                      getHostKey(session.id)
                        ? sessionPath('/receipt-detail', session.id)
                        : sessionPath('/claim', session.id),
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </ListLayout>
      )}
    </>
  );
}
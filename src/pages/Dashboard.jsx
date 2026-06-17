import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { Plus, Receipt, CheckCircle2, Clock, Users, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSaveScroll } from "@/hooks/useTabHistory";
import { useTabNav } from "@/lib/TabNavigationContext";
import { useAuth } from "@/lib/AuthContext";
import ListLayout from "@/components/ListLayout";
import DashboardSkeleton from "@/components/DashboardSkeleton";

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

export default function Dashboard() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const { ref: scrollRef, onScroll, restoreScroll } = useSaveScroll("dashboard");
  const { pushScreen } = useTabNav();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();

  // Back-button protection: if not authenticated after auth check, go to landing
  useEffect(() => {
    if (!isLoadingAuth && !isAuthenticated) {
      window.location.replace('/');
    }
  }, [isAuthenticated, isLoadingAuth]);

  const fetchSessions = useCallback(async () => {
    const data = await base44.entities.Session.list("-created_date", 20);
    setSessions(data);
    setLoading(false);
    setTimeout(restoreScroll, 50);
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  useEffect(() => {
    const unsub = base44.entities.Session.subscribe((event) => {
      if (event.type === 'create')  setSessions(prev => [event.data, ...prev]);
      if (event.type === 'update')  setSessions(prev => prev.map(s => s.id === event.id ? event.data : s));
      if (event.type === 'delete')  setSessions(prev => prev.filter(s => s.id !== event.id));
    });
    return unsub;
  }, []);

  const { totalOwed, totalCollected } = useMemo(() => ({
    totalOwed: sessions.reduce((sum, s) =>
      sum + (s.participants || []).filter(p => p.payment_status !== "paid").reduce((a, p) => a + (p.amount_owed || 0), 0), 0),
    totalCollected: sessions.reduce((sum, s) =>
      sum + (s.participants || []).filter(p => p.payment_status === "paid").reduce((a, p) => a + (p.amount_owed || 0), 0), 0),
  }), [sessions]);

  const statCards = [
    { label: "Bills Split",   value: sessions.length,             icon: Receipt,      color: "from-violet-500 to-purple-600" },
    { label: "Outstanding",   value: `$${totalOwed.toFixed(2)}`,  icon: Clock,        color: "from-amber-400 to-orange-400" },
    { label: "Collected",     value: `$${totalCollected.toFixed(2)}`, icon: CheckCircle2, color: "from-emerald-400 to-teal-500" },
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
                <p className="text-muted-foreground text-sm mt-0.5">Your recent splits</p>
              </div>
              <button
                onClick={() => pushScreen(createPageUrl("NewReceipt"))}
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
                  onClick={() => pushScreen(createPageUrl("NewReceipt"))}
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
                    onClick={() => pushScreen(createPageUrl(`ReceiptDetail?id=${session.id}&host=1`))}
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
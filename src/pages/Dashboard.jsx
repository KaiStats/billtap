import { useState, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { Plus, Receipt, CheckCircle2, Clock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useSaveScroll } from "@/hooks/useTabHistory";
import { useTabNav } from "@/lib/TabNavigationContext";
import PullToRefresh from "@/components/PullToRefresh";

const statusColors = {
  waiting: "bg-warning-muted text-warning-muted-foreground",
  claiming: "bg-info-muted text-info-muted-foreground",
  completed: "bg-success-muted text-success-muted-foreground",
};

export default function Dashboard() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const { ref: scrollRef, onScroll, restoreScroll } = useSaveScroll("dashboard");
  const { pushScreen } = useTabNav();

  const fetchSessions = useCallback(async () => {
    const data = await base44.entities.Session.list("-created_date", 50);
    setSessions(data);
    setLoading(false);
    setTimeout(restoreScroll, 50);
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const { totalOwed, totalCollected } = useMemo(() => ({
    totalOwed: sessions.reduce((sum, s) =>
      sum + (s.participants || []).filter(p => p.payment_status !== "paid").reduce((a, p) => a + (p.amount_owed || 0), 0), 0),
    totalCollected: sessions.reduce((sum, s) =>
      sum + (s.participants || []).filter(p => p.payment_status === "paid").reduce((a, p) => a + (p.amount_owed || 0), 0), 0),
  }), [sessions]);

  return (
    <div className="min-h-screen bg-surface">
      <PullToRefresh onRefresh={fetchSessions}>
        <div ref={scrollRef} onScroll={onScroll} className="max-w-4xl mx-auto p-5 space-y-5 pb-28">

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Bills Split", value: sessions.length, icon: Receipt, iconClass: "text-brand bg-brand-muted" },
              { label: "Outstanding", value: `$${totalOwed.toFixed(2)}`, icon: Clock, iconClass: "text-warning bg-warning-muted" },
              { label: "Collected", value: `$${totalCollected.toFixed(2)}`, icon: CheckCircle2, iconClass: "text-success bg-success-muted" },
            ].map(({ label, value, icon: Icon, iconClass }) => (
              <Card key={label} className="rounded-2xl border-0 shadow-sm" aria-label={`${label}: ${value}`}>
                <CardContent className="p-5 flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${iconClass}`}>
                    <Icon className="w-6 h-6" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="text-2xl font-black text-foreground" aria-hidden="true">{value}</div>
                    <div className="text-sm text-muted-foreground" aria-hidden="true">{label}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Header */}
          <div className="flex items-center justify-between pt-2">
            <div>
              <h1 className="text-2xl font-black text-foreground">BillTap</h1>
              <p className="text-muted-foreground text-sm mt-0.5">Your bills &amp; splits</p>
            </div>
            <Button onClick={() => pushScreen(createPageUrl("NewReceipt"))} className="bg-brand hover:bg-brand/90 text-brand-foreground font-semibold rounded-xl h-11 px-4">
              <Plus className="mr-2 w-4 h-4" aria-hidden="true" /> New Split
            </Button>
          </div>

          {loading ? (
            <div className="text-center py-20 text-muted-foreground flex flex-col items-center gap-3" role="status" aria-live="polite">
              <div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" aria-hidden="true" />
              <span>Loading…</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-20">
              <Receipt className="w-16 h-16 mx-auto text-muted-foreground mb-4" aria-hidden="true" />
              <p className="text-muted-foreground text-lg">No bills yet.</p>
              <Button onClick={() => pushScreen(createPageUrl("NewReceipt"))} className="mt-4 bg-brand hover:bg-brand/90 text-brand-foreground rounded-xl">Split your first bill</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => {
                const paid = (session.participants || []).filter(p => p.payment_status === "paid").length;
                const total = (session.participants || []).length;
                return (
                  <button key={session.id} onClick={() => pushScreen(createPageUrl(`ReceiptDetail?id=${session.id}&host=1`))} className="w-full text-left">
                    <Card className="rounded-2xl border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                      <CardContent className="p-5 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-brand-muted rounded-xl flex items-center justify-center">
                            <Receipt className="w-6 h-6 text-brand" aria-hidden="true" />
                          </div>
                          <div>
                            <div className="font-bold text-foreground text-base">{session.title}</div>
                            <div className="text-sm text-muted-foreground flex items-center gap-2 mt-0.5">
                              <Users className="w-3.5 h-3.5" aria-hidden="true" />
                              {total} people · ${(session.total_amount || 0).toFixed(2)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-sm text-muted-foreground">{paid}/{total} paid</div>
                          <Badge className={statusColors[session.status] || statusColors.waiting}>
                            {session.status || "waiting"}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PullToRefresh>
    </div>
  );
}
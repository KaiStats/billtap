import { useState, useEffect, useCallback } from "react";
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
  waiting: "bg-yellow-100 text-yellow-800",
  claiming: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
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

  const totalOwed = sessions.reduce((sum, s) => {
    return sum + (s.participants || []).filter(p => p.payment_status !== "paid").reduce((a, p) => a + (p.amount_owed || 0), 0);
  }, 0);
  const totalCollected = sessions.reduce((sum, s) => {
    return sum + (s.participants || []).filter(p => p.payment_status === "paid").reduce((a, p) => a + (p.amount_owed || 0), 0);
  }, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <PullToRefresh onRefresh={fetchSessions}>
        <div ref={scrollRef} onScroll={onScroll} className="max-w-4xl mx-auto p-5 space-y-5 pb-28">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Bills Split", value: sessions.length, icon: Receipt, color: "text-purple-600 bg-purple-50" },
            { label: "Outstanding", value: `$${totalOwed.toFixed(2)}`, icon: Clock, color: "text-orange-600 bg-orange-50" },
            { label: "Collected", value: `$${totalCollected.toFixed(2)}`, icon: CheckCircle2, color: "text-green-600 bg-green-50" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="rounded-2xl border-0 shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-2xl font-black text-gray-900">{value}</div>
                  <div className="text-sm text-gray-500">{label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Header */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <h1 className="text-2xl font-black text-gray-900">BillTap</h1>
            <p className="text-gray-500 text-sm mt-0.5">Your bills & splits</p>
          </div>
          <Button onClick={() => pushScreen(createPageUrl("NewReceipt"))} className="bg-purple-600 hover:bg-purple-700 font-semibold rounded-xl h-11 px-4">
            <Plus className="mr-2 w-4 h-4" /> New Split
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-400">Loading...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-20">
            <Receipt className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 text-lg">No bills yet.</p>
            <Button onClick={() => pushScreen(createPageUrl("NewReceipt"))} className="mt-4 bg-purple-600 hover:bg-purple-700 rounded-xl">Split your first bill</Button>
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
                        <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                          <Receipt className="w-6 h-6 text-purple-600" />
                        </div>
                        <div>
                          <div className="font-bold text-gray-900">{session.title}</div>
                          <div className="text-sm text-gray-500 flex items-center gap-2 mt-0.5">
                            <Users className="w-3.5 h-3.5" />
                            {total} people · ${(session.total_amount || 0).toFixed(2)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-sm text-gray-500">{paid}/{total} paid</div>
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
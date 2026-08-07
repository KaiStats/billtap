import { useQuery } from '@tanstack/react-query';
import { listSplits } from '@/lib/splitHistory';
import { Button } from '@/components/ui/button';
import { Plus, Clock, TrendingUp, Users, ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import ListLayout from '@/components/ListLayout';
import { useNavigate } from 'react-router';
import { sessionPath } from '@/lib/sessionLinks';

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();

  /**
   * From the device rather than from the server.
   *
   * This was an owner-scoped entity list, which no longer has anything serving
   * it: the Worker exposes a split by id, not a list by owner. The local index
   * in src/lib/splitHistory.js is what a guest has always used and it holds
   * everything this browser has taken part in — which for a single-device
   * operator is the same set, and for one who moves between devices is less.
   * Restoring the difference needs a list-by-owner endpoint.
   */
  const { data: sessions = [], refetch } = useQuery({
    queryKey: ['sessions', 'home'],
    queryFn: async () => listSplits().slice(0, 50).map((e) => ({
      id: e.id,
      title: e.title || 'Split',
      total_amount: e.total,
      status: e.status || 'claiming',
      // The index stores a count; this screen renders "N people". An array of
      // the right length is all it reads.
      participants: Array.from({ length: e.participants || 0 }),
    })),
  });

  const recentSessions = sessions.slice(0, 3);
  const totalSessions = sessions.length;
  const completedSessions = sessions.filter(s => s.status === 'completed').length;
  const activeSessions = sessions.filter(s => s.status !== 'completed').length;

  const stats = [
    { icon: Users, label: 'Sessions', value: totalSessions || '0', color: 'from-violet-500 to-purple-600' },
    { icon: TrendingUp, label: 'Completed', value: completedSessions || '0', color: 'from-emerald-400 to-teal-500' },
    { icon: Clock, label: 'Active', value: activeSessions || '0', color: 'from-pink-500 to-rose-400' },
  ];

  const statusLabel = (status) => {
    if (status === 'completed') return { label: 'Done', cls: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' };
    if (status === 'claiming') return { label: 'In Progress', cls: 'bg-blue-500/15 text-blue-400 border border-blue-500/20' };
    return { label: 'Waiting', cls: 'bg-amber-500/15 text-amber-400 border border-amber-500/20' };
  };

  return (
    <ListLayout onRefresh={refetch} className="bg-background">
      {/* Hero Header */}
      <div
        className="relative overflow-hidden px-5 pt-10 pb-8"
        style={{ background: 'linear-gradient(160deg, #0f0c29 0%, #302b63 60%, #1a1535 100%)' }}
      >
        {/* Glow blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div style={{ position: 'absolute', top: '-20%', right: '-10%', width: '50vw', height: '50vw', maxWidth: 300, maxHeight: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(102,126,234,0.4) 0%, transparent 70%)', filter: 'blur(50px)' }} />
          <div style={{ position: 'absolute', bottom: '-30%', left: '-10%', width: '40vw', height: '40vw', maxWidth: 250, maxHeight: 250, borderRadius: '50%', background: 'radial-gradient(circle, rgba(245,87,108,0.3) 0%, transparent 70%)', filter: 'blur(40px)' }} />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto">
          <p className="text-white/50 text-sm font-medium mb-1 uppercase tracking-widest">Welcome back</p>
          <h1 className="text-3xl font-black text-white tracking-tight leading-tight mb-1">
            {user?.full_name ? user.full_name.split(' ')[0] : 'Hey there'} 👋
          </h1>
          <p className="text-white/60 text-base">Split bills with friends in seconds</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-5 space-y-6 py-6 pb-28">
        {/* CTA Button */}
        <button
          onClick={() => navigate('/new-receipt')}
          className="w-full h-16 text-white font-black text-lg rounded-2xl flex items-center justify-center gap-3 shadow-2xl transition-all hover:-translate-y-0.5 active:translate-y-0"
          style={{ background: 'linear-gradient(135deg, #f5576c, #f093fb, #667eea)' }}
        >
          <Plus className="w-6 h-6" />
          Create New Split
        </button>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="rounded-2xl p-4"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <div className="flex flex-col items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                    <Icon className="w-4 h-4 text-white" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-2xl font-black text-foreground">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Recent Splits</h2>
            <div className="space-y-2">
              {recentSessions.map((session) => {
                const { label, cls } = statusLabel(session.status);
                return (
                  <button
                    key={session.id}
                    onClick={() => navigate(sessionPath('/receipt-detail', session.id, { host: 1 }))}
                    className="w-full rounded-2xl p-4 text-left flex items-center justify-between transition-all group"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                    onMouseEnter={e => e.currentTarget.style.border = '1px solid rgba(255,255,255,0.15)'}
                    onMouseLeave={e => e.currentTarget.style.border = '1px solid rgba(255,255,255,0.07)'}
                  >
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground truncate">{session.title}</h3>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {session.participants?.length || 0} people ·{' '}
                        <span className="text-brand font-semibold">${session.total_amount?.toFixed(2) || '0.00'}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${cls}`}>{label}</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Empty State */}
        {recentSessions.length === 0 && (
          <div className="text-center py-14 rounded-2xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-white" aria-hidden="true" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">No splits yet</h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-xs mx-auto">
              Snap a receipt, share a QR code, and split in 30 seconds flat.
            </p>
            <Button
              onClick={() => navigate('/new-receipt')}
              className="bg-brand hover:bg-brand/90 text-brand-foreground font-bold rounded-xl px-6"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Split
            </Button>
          </div>
        )}
      </div>
    </ListLayout>
  );
}
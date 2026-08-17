import { useQuery } from '@tanstack/react-query';
import { listSplits } from '@/lib/splitHistory';
import { computeTab, stillOwing } from '@/lib/runningTab';
import { invoke } from '@/api/functions';
import { Button } from '@/components/ui/button';
import { Plus, Clock, TrendingUp, Users, ChevronRight, Receipt, Sparkles } from 'lucide-react';
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

  /**
   * Whether to draw the running tab or the offer to unlock it.
   *
   * The server is the authority — getMyPlan reads the same Profile row
   * resolvePartyLimit enforces the cap from — so the screen shows what the
   * server will actually honour rather than guessing. Defaults to free while it
   * loads and on any error, which is the safe direction: a Pro user waiting a
   * beat for their tab, never a free user shown a paid view.
   */
  const { data: plan } = useQuery({
    queryKey: ['my-plan'],
    queryFn: async () => (await invoke('getMyPlan', {}))?.data ?? { pro: false },
    staleTime: 60_000,
  });
  const isPro = Boolean(plan?.pro);

  // The tab is computed from the raw index, not from `sessions` above, because
  // that map drops the paid count this needs. listSplits is already read once
  // by React Query; this is a cheap second pass over the same localStorage.
  const tab = computeTab(listSplits());

  const recentSessions = sessions.slice(0, 3);
  const totalSessions = sessions.length;
  const completedSessions = sessions.filter(s => s.status === 'completed').length;
  const activeSessions = sessions.filter(s => s.status !== 'completed').length;

  const stats = [
    { icon: Users, label: 'Sessions', value: totalSessions || '0', color: 'from-sky-400 to-cyan-500' },
    { icon: TrendingUp, label: 'Completed', value: completedSessions || '0', color: 'from-emerald-400 to-teal-500' },
    { icon: Clock, label: 'Active', value: activeSessions || '0', color: 'from-primary to-emerald-500' },
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
        style={{ background: 'linear-gradient(165deg, #070b16 0%, #0d1728 55%, #070b16 100%)' }}
      >
        {/* Glow blobs — teal aurora */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div style={{ position: 'absolute', top: '-20%', right: '-10%', width: '50vw', height: '50vw', maxWidth: 300, maxHeight: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,200,150,0.28) 0%, transparent 70%)', filter: 'blur(50px)' }} />
          <div style={{ position: 'absolute', bottom: '-30%', left: '-10%', width: '40vw', height: '40vw', maxWidth: 250, maxHeight: 250, borderRadius: '50%', background: 'radial-gradient(circle, rgba(56,189,248,0.16) 0%, transparent 70%)', filter: 'blur(40px)' }} />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto">
          <h1 className="font-display text-3xl font-bold text-white tracking-tight leading-tight mb-1.5">
            Welcome back, {user?.full_name ? user.full_name.split(' ')[0] : 'friend'} 👋
          </h1>
          <p className="text-white/60 text-base">Split bills with friends in seconds</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-5 space-y-6 py-6 pb-28">
        {/* CTA Button */}
        <button
          onClick={() => navigate('/new-receipt')}
          className="press w-full h-16 bg-primary text-primary-foreground font-bold text-lg rounded-2xl flex items-center justify-center gap-3 shadow-glow transition hover:brightness-110"
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
                    <p className="mono text-2xl font-semibold tabular-nums text-foreground">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Your Tab — Pro. Only worth showing at all when something is owed. */}
        {isPro && tab.count > 0 && (
          <section className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Receipt className="w-4 h-4 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-foreground">Your Tab</h2>
              <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/20">PRO</span>
            </div>
            <div className="rounded-2xl p-4 mb-2" style={{ background: 'rgba(0,200,150,0.06)', border: '1px solid rgba(0,200,150,0.18)' }}>
              <p className="text-sm text-white/70">
                <span className="font-semibold text-foreground">{tab.count}</span> bill{tab.count === 1 ? '' : 's'} still settling
                {tab.asHost > 0 && <> · you hosted {tab.asHost}</>}
              </p>
              {/* "across these bills", never "owed to you" — the index does not
                  know per-person shares, so the app does not claim to. */}
              <p className="mono text-2xl font-semibold tabular-nums text-primary mt-1">
                ${tab.billsTotal.toFixed(2)}
                <span className="text-xs text-white/40 font-sans ml-2">across these bills</span>
              </p>
            </div>
            <div className="space-y-2">
              {tab.unsettled.slice(0, 6).map((e) => {
                const owing = stillOwing(e);
                return (
                  <button
                    key={e.id}
                    onClick={() => navigate(sessionPath('/receipt-detail', e.id, { host: e.role === 'host' ? 1 : 0 }))}
                    className="press w-full rounded-2xl p-4 text-left flex items-center justify-between transition-[transform,border-color,background-color] duration-200 ease-out-expo hover:-translate-y-0.5 hover:bg-white/[0.05] group"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                  >
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground truncate">{e.title || 'Split'}</h3>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {(e.participants || 0) > 0
                          ? <>{(e.paid || 0)} of {e.participants} paid{owing > 0 && <> · {owing} still owing</>}</>
                          : 'not shared yet'}
                        {' · '}
                        <span className="mono text-primary font-semibold tabular-nums">${(e.total || 0).toFixed(2)}</span>
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground ml-3 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* The offer, for a free user who has bills that are still settling.
            Shown only when there is something a tab would actually help with —
            an empty tab is not a reason to sell one. */}
        {!isPro && tab.count > 1 && (
          <section className="mb-6">
            <button
              onClick={() => navigate('/#pricing')}
              className="press w-full rounded-2xl p-4 text-left flex items-center gap-3 transition-transform duration-200 hover:-translate-y-0.5"
              style={{ background: 'rgba(0,200,150,0.06)', border: '1px solid rgba(0,200,150,0.18)' }}
            >
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground text-sm">
                  You have {tab.count} bills still settling
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Keep them all in one running tab with Pro — see what's outstanding at a glance.
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
            </button>
          </section>
        )}

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
                    className="press w-full rounded-2xl p-4 text-left flex items-center justify-between transition-[transform,border-color,background-color] duration-200 ease-out-expo hover:-translate-y-0.5 hover:bg-white/[0.05] group"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'hsl(var(--primary) / 0.35)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'}
                  >
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground truncate">{session.title}</h3>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {session.participants?.length || 0} people ·{' '}
                        <span className="mono text-primary font-semibold tabular-nums">${session.total_amount?.toFixed(2) || '0.00'}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${cls}`}>{label}</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
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
            <div className="w-16 h-16 rounded-2xl bg-primary/10 ring-hairline flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-primary" aria-hidden="true" />
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
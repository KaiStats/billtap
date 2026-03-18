import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Plus, Clock, TrendingUp, Users } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useScrollBehavior } from '@/hooks/useScrollBehavior';

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions', 'home'],
    queryFn: async () => {
      const result = await base44.entities.Session.filter({}, '-updated_date', 3);
      return result;
    },
  });

  const totalSessions = sessions.length;
  const completedSessions = sessions.filter(s => s.status === 'completed').length;

  const stats = [
    { icon: Users, label: 'Sessions', value: totalSessions || '0' },
    { icon: TrendingUp, label: 'Completed', value: completedSessions || '0' },
    { icon: Clock, label: 'Active', value: sessions.filter(s => s.status !== 'completed').length || '0' },
  ];

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <div className="bg-gradient-to-b from-brand/10 to-transparent pt-8 pb-6 px-5">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-foreground mb-2">
            Welcome back{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}!
          </h1>
          <p className="text-muted-foreground text-lg">
            Split bills with friends in seconds
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-5 space-y-8 py-8">
        {/* CTA Button */}
        <Button
          onClick={() => navigate('/NewReceipt')}
          className="w-full h-16 text-lg font-semibold bg-brand hover:bg-brand/90 text-brand-foreground shadow-lg rounded-2xl"
        >
          <Plus className="w-6 h-6 mr-2" />
          Create New Split
        </Button>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="rounded-2xl bg-card border border-border p-4 shadow-sm"
              >
                <div className="flex flex-col items-start gap-3">
                  <div className="p-2.5 rounded-lg bg-brand/10">
                    <Icon className="w-5 h-5 text-brand" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Recent Sessions */}
        {sessions.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">Recent Splits</h2>
            <div className="space-y-3">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => navigate(`/SessionHost`, { state: { sessionId: session.id } })}
                  className="w-full rounded-2xl bg-card border border-border p-5 shadow-sm hover:shadow-md transition-shadow text-left"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground truncate">{session.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        {session.participants?.length || 0} people • ${session.total_amount?.toFixed(2) || '0.00'}
                      </p>
                    </div>
                    <div className="ml-4 text-right">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                          session.status === 'completed'
                            ? 'bg-success/10 text-success-color'
                            : session.status === 'claiming'
                            ? 'bg-brand/10 text-brand'
                            : 'bg-warning/10 text-warning-color'
                        }`}
                      >
                        {session.status === 'completed' ? 'Done' : session.status === 'claiming' ? 'In Progress' : 'Waiting'}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {sessions.length === 0 && (
          <div className="text-center py-12">
            <div className="mb-4">
              <Users className="w-12 h-12 text-muted-foreground mx-auto opacity-50" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No splits yet</h3>
            <p className="text-muted-foreground mb-6">
              Create your first split to get started splitting bills with friends
            </p>
            <Button
              onClick={() => navigate('/NewReceipt')}
              variant="outline"
              className="mx-auto"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Split
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
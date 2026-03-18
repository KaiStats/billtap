import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import AppHeader from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Trash2, LogOut, User, AlertTriangle } from "lucide-react";

export default function Profile() {
  const { user } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleLogout = () => {
    base44.auth.logout();
  };

  const handleDeleteAccount = async () => {
    if (confirmText !== "DELETE") return;
    setDeleting(true);
    const sessions = await base44.entities.Session.list();
    const mine = sessions.filter(s => s.created_by === user?.email);
    await Promise.all(mine.map(s => base44.entities.Session.delete(s.id)));
    base44.auth.logout();
  };

  return (
    <div className="min-h-screen bg-surface">
      <AppHeader title="Profile" />

      <div className="max-w-lg mx-auto p-5 space-y-5 pb-28">
        {/* User info */}
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-14 h-14 bg-brand-muted rounded-2xl flex items-center justify-center shrink-0">
              <User className="w-7 h-7 text-brand" aria-hidden="true" />
            </div>
            <div>
              <div className="font-bold text-foreground text-lg">{user?.full_name || "You"}</div>
              <div className="text-muted-foreground text-sm">{user?.email}</div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardContent className="p-2 space-y-1">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-xl text-foreground hover:bg-accent active:bg-accent/80 transition-colors text-left"
            >
              <LogOut className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">Sign Out</span>
            </button>
          </CardContent>
        </Card>

        {/* Danger zone */}
        <Card className="rounded-2xl border-0 shadow-sm border border-destructive/20">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              <span className="font-bold">Danger Zone</span>
            </div>

            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-xl bg-danger-muted text-danger-muted-foreground hover:bg-destructive/20 active:bg-destructive/30 transition-colors font-medium"
              >
                <Trash2 className="w-5 h-5" aria-hidden="true" />
                Delete Account
              </button>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  This will permanently delete your account and all your bill sessions. Type <strong>DELETE</strong> to confirm.
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder="Type DELETE to confirm"
                  className="w-full border border-destructive/40 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-destructive bg-background text-foreground"
                  autoFocus
                />
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => { setShowDeleteConfirm(false); setConfirmText(""); }}
                    className="flex-1 h-11 rounded-xl"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleDeleteAccount}
                    disabled={confirmText !== "DELETE" || deleting}
                    className="flex-1 h-11 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold disabled:opacity-40"
                  >
                    {deleting ? "Deleting…" : "Delete Account"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
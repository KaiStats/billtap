import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import AppHeader from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, LogOut, User, AlertTriangle } from "lucide-react";

export default function Profile() {
  const { user, logout } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleLogout = () => {
    console.log("[USER_LOGOUT]", user?.email);
    logout();
  };

  const handleDeleteAccount = async () => {
    if (confirmText !== "DELETE") return;
    setDeleting(true);
    try {
      await base44.functions.invoke('deleteAccount', {});
      base44.auth.logout();
    } catch (error) {
      alert('Failed to delete account. Please try again or contact support.');
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-28">
      <AppHeader
        title="Profile"
        rightAction={
          <button
            onClick={handleLogout}
            aria-label="Sign out"
            className="p-2 rounded-xl text-white/40 hover:text-destructive hover:bg-danger-muted transition-colors"
          >
            <LogOut className="w-5 h-5" aria-hidden="true" />
          </button>
        }
      />

      {/* Hero Header */}
      <div
        className="relative overflow-hidden px-5 pt-8 pb-8"
        style={{ background: 'linear-gradient(160deg, #0f0c29 0%, #1a1535 100%)' }}
      >
        <div className="absolute inset-0 pointer-events-none">
          <div style={{ position: 'absolute', top: '-20%', right: '-10%', width: '40vw', height: '40vw', maxWidth: 220, maxHeight: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(102,126,234,0.35) 0%, transparent 70%)', filter: 'blur(40px)' }} />
        </div>
        <div className="relative z-10 max-w-lg mx-auto flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0">
            <User className="w-8 h-8 text-white" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">{user?.full_name || "You"}</h1>
            <p className="text-white/50 text-sm mt-0.5">{user?.email}</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-5 py-5 space-y-4">

        {/* Sign Out Button */}
        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="w-full flex items-center gap-3 px-5 py-4 rounded-2xl font-semibold text-destructive transition-all text-left"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(239,68,68,0.2)' }}
          onMouseEnter={e => e.currentTarget.style.border = '1px solid rgba(239,68,68,0.4)'}
          onMouseLeave={e => e.currentTarget.style.border = '1px solid rgba(239,68,68,0.2)'}
        >
          <LogOut className="w-5 h-5" aria-hidden="true" />
          Sign Out
        </button>

        {/* Danger Zone */}
        <div
          className="rounded-2xl p-5 space-y-4"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(239,68,68,0.15)' }}
        >
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            <span className="font-bold text-lg">Danger Zone</span>
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
              <div className="bg-danger-muted rounded-xl p-4 border border-destructive/20">
                <div className="font-semibold text-danger-muted-foreground text-sm mb-2">This will permanently delete:</div>
                <ul className="text-xs text-danger-muted-foreground space-y-1 list-disc list-inside">
                  <li>Your account and profile</li>
                  <li>All bill split history</li>
                  <li>Payment records</li>
                </ul>
              </div>
              <p className="text-sm text-muted-foreground">
                Type <strong className="text-foreground">DELETE</strong> to permanently delete your account.
              </p>
              <Input
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="Type DELETE to confirm"
                aria-label="Type DELETE to confirm account deletion"
                className="rounded-xl border-destructive/40 focus-visible:border-destructive focus-visible:ring-destructive/50"
                autoFocus
              />
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => { setShowDeleteConfirm(false); setConfirmText(""); }}
                  className="flex-1 h-11 rounded-xl"
                  aria-label="Cancel account deletion"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleDeleteAccount}
                  disabled={confirmText !== "DELETE" || deleting}
                  className="flex-1 h-11 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold disabled:opacity-40"
                  aria-label="Confirm account deletion"
                >
                  {deleting ? "Deleting…" : "Delete Account"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sign Out Confirmation Dialog */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm p-4 pb-8">
          <div className="bg-card rounded-2xl p-6 w-full max-w-sm shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-danger-muted flex items-center justify-center shrink-0">
                <LogOut className="w-5 h-5 text-destructive" aria-hidden="true" />
              </div>
              <div>
                <div className="font-bold text-foreground">Sign out of BillTap?</div>
                <div className="text-sm text-muted-foreground">You can sign back in anytime.</div>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" onClick={() => setShowLogoutConfirm(false)} className="flex-1 h-11 rounded-xl">Cancel</Button>
              <Button onClick={handleLogout} className="flex-1 h-11 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold">
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
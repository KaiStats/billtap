import { memo } from "react";
import { useLocation } from "react-router-dom";
import { Home, LayoutDashboard, Plus, UserCircle, LogOut } from "lucide-react";
import { useTabNav, getTabForPath } from "@/lib/TabNavigationContext";
import { useAuth } from "@/lib/AuthContext";
import { base44 } from "@/api/base44Client";

const navItems = [
  { label: "Home", icon: Home, path: "/home" },
  { label: "New Split", icon: Plus, path: "/new-receipt", highlight: true },
  { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  { label: "Profile", icon: UserCircle, path: "/profile" },
];

async function checkActiveSessions() {
  try {
    const sessions = await base44.entities.Session.filter({ status: "claiming" });
    return sessions && sessions.length > 0;
  } catch {
    return false;
  }
}

const BottomNav = memo(function BottomNav() {
  const location = useLocation();
  const { switchTab } = useTabNav();
  const { logout, isAuthenticated } = useAuth();

  const handleLogout = async () => {
    const hasActive = await checkActiveSessions();
    if (hasActive) {
      const confirmed = window.confirm(
        "You have an active bill split in progress.\n\nGuests can still claim items after you log out, but you won't be able to monitor it.\n\nLog out anyway?"
      );
      if (!confirmed) return;
    }
    logout();
  };

  const hiddenPaths = ["/claim", "/Claim", "/session-host", "/SessionHost", "/LandingPage", "/privacy", "/terms"];
  if (hiddenPaths.some(p => location.pathname.startsWith(p))) return null;

  const activeTab = getTabForPath(location.pathname);

  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 left-0 right-0 z-50 bg-surface-raised border-t border-border flex items-center justify-around"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {navItems.map(({ label, icon: Icon, path, highlight }) => {
        const tabKey = getTabForPath(path);
        const isActive = activeTab === tabKey;
        if (highlight) {
          return (
            <button key={path} onClick={() => switchTab(path)} aria-label={label} aria-current={isActive ? "page" : undefined} className="flex flex-col items-center justify-center flex-1 py-2 min-h-[44px]">
              <div className="w-12 h-12 bg-brand rounded-2xl flex items-center justify-center shadow-lg -mt-4">
                <Icon className="w-6 h-6 text-brand-foreground" aria-hidden="true" />
              </div>
              <span className="text-xs font-medium mt-0.5 text-brand">{label}</span>
            </button>
          );
        }
        return (
          <button
            key={path}
            onClick={() => switchTab(path)}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-col items-center justify-center flex-1 py-2 gap-0.5 min-h-[44px] transition-colors ${isActive ? "text-brand" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="w-6 h-6" aria-hidden="true" />
            <span className="text-xs font-medium">{label}</span>
          </button>
        );
      })}
      {isAuthenticated && (
        <button
          onClick={handleLogout}
          aria-label="Log out"
          className="flex flex-col items-center justify-center flex-1 py-2 gap-0.5 min-h-[44px] transition-colors text-muted-foreground hover:text-destructive"
        >
          <LogOut className="w-6 h-6" aria-hidden="true" />
          <span className="text-xs font-medium">Logout</span>
        </button>
      )}
    </nav>
  );
});

export default BottomNav;
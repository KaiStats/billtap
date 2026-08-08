import { memo } from "react";
import { useLocation } from "react-router";
import { Home, LayoutDashboard, Plus, UserCircle } from "lucide-react";
import { useTabNav, getTabForPath } from "@/lib/TabNavigationContext";

const navItems = [
  { label: "Home", icon: Home, path: "/home" },
  { label: "New Split", icon: Plus, path: "/new-receipt", highlight: true },
  { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  { label: "Profile", icon: UserCircle, path: "/profile" },
];

const BottomNav = memo(function BottomNav() {
  const location = useLocation();
  const { switchTab } = useTabNav();

  const hiddenPaths = ["/claim", "/Claim", "/session-host", "/SessionHost", "/privacy", "/terms", "/login", "/register", "/about", "/blog", "/changelog", "/icon-generator", "/restaurants", "/Restaurants", "/r/", "/restaurant-dashboard"];
  if (location.pathname === "/" || hiddenPaths.some(p => location.pathname.startsWith(p))) return null;

  const activeTab = getTabForPath(location.pathname);

  return (
    <nav
      aria-label="Main navigation"
      className="glass fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-x-0 border-b-0"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {navItems.map(({ label, icon: Icon, path, highlight }) => {
        const tabKey = getTabForPath(path);
        const isActive = activeTab === tabKey;
        if (highlight) {
          return (
            <button key={path} onClick={() => switchTab(path)} aria-label={label} aria-current={isActive ? "page" : undefined} className="press flex flex-col items-center justify-center flex-1 py-2 min-h-[44px]">
              <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center shadow-glow -mt-5">
                <Icon className="w-6 h-6 text-primary-foreground" aria-hidden="true" />
              </div>
              <span className="text-[11px] font-semibold mt-0.5 text-primary">{label}</span>
            </button>
          );
        }
        return (
          <button
            key={path}
            onClick={() => switchTab(path)}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            className={`press flex flex-col items-center justify-center flex-1 py-2 gap-0.5 min-h-[44px] transition-colors duration-200 ${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className={`w-6 h-6 transition-transform duration-200 ${isActive ? "scale-105" : ""}`} aria-hidden="true" />
            <span className="text-[11px] font-semibold">{label}</span>
          </button>
        );
      })}
    </nav>
  );
});

export default BottomNav;
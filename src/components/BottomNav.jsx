import { memo } from "react";
import { useLocation } from "react-router-dom";
import { Home, LayoutDashboard, Plus, UserCircle } from "lucide-react";
import { useTabNav, getTabForPath } from "@/lib/TabNavigationContext";

const navItems = [
  { label: "Home", icon: Home, path: "/Home" },
  { label: "New Split", icon: Plus, path: "/NewReceipt", highlight: true },
  { label: "Dashboard", icon: LayoutDashboard, path: "/Dashboard" },
  { label: "Profile", icon: UserCircle, path: "/Profile" },
];

const BottomNav = memo(function BottomNav() {
  const location = useLocation();
  const { switchTab } = useTabNav();

  const hiddenPaths = ["/Claim", "/SessionHost"];
  if (hiddenPaths.some(p => location.pathname.startsWith(p))) return null;

  const activeTab = getTabForPath(location.pathname);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex items-center justify-around"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {navItems.map(({ label, icon: Icon, path, highlight }) => {
        const tabKey = getTabForPath(path);
        const isActive = activeTab === tabKey;
        if (highlight) {
          return (
            <button key={path} onClick={() => switchTab(path)} className="flex flex-col items-center justify-center flex-1 py-2 min-h-[44px]">
              <div className="w-12 h-12 bg-purple-600 rounded-2xl flex items-center justify-center shadow-lg -mt-4">
                <Icon className="w-6 h-6 text-white" />
              </div>
            </button>
          );
        }
        return (
          <button
            key={path}
            onClick={() => switchTab(path)}
            className={`flex flex-col items-center justify-center flex-1 py-2 gap-0.5 min-h-[44px] transition-colors ${isActive ? "text-purple-600" : "text-gray-400 hover:text-gray-600"}`}
          >
            <Icon className="w-6 h-6" />
            <span className="text-xs font-medium">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
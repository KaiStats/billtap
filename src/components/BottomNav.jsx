import { Link, useLocation } from "react-router-dom";
import { Home, LayoutDashboard, Plus } from "lucide-react";

const navItems = [
  { label: "Home", icon: Home, path: "/Home" },
  { label: "New Split", icon: Plus, path: "/NewReceipt", highlight: true },
  { label: "Dashboard", icon: LayoutDashboard, path: "/Dashboard" },
];

export default function BottomNav() {
  const location = useLocation();

  // Hide on claim/session pages
  const hiddenPaths = ["/Claim", "/SessionHost"];
  if (hiddenPaths.some(p => location.pathname.startsWith(p))) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex items-center justify-around"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {navItems.map(({ label, icon: Icon, path, highlight }) => {
        const isActive = location.pathname === path || (path === "/Home" && location.pathname === "/");
        return (
          <Link
            key={path}
            to={path}
            className={`flex flex-col items-center justify-center flex-1 py-3 gap-0.5 transition-colors ${
              highlight
                ? "relative"
                : isActive
                ? "text-purple-600"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {highlight ? (
              <div className="w-12 h-12 bg-purple-600 rounded-2xl flex items-center justify-center shadow-lg -mt-5">
                <Icon className="w-6 h-6 text-white" />
              </div>
            ) : (
              <>
                <Icon className={`w-6 h-6 ${isActive ? "text-purple-600" : "text-gray-400"}`} />
                <span className={`text-xs font-medium ${isActive ? "text-purple-600" : "text-gray-400"}`}>
                  {label}
                </span>
              </>
            )}
            {!highlight && (
              <span className={`text-xs font-medium ${isActive ? "text-purple-600" : "text-gray-400"}`}>
                {label}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
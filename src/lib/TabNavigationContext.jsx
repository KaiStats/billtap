import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// Which bottom-nav tab does a path belong to?
export const TAB_ROOTS = {
  "/Home": "Home",
  "/": "Home",
  "/Dashboard": "Dashboard",
  "/NewReceipt": "NewReceipt",
  "/Profile": "Profile",
};

export function getTabForPath(pathname) {
  // Exact match first
  if (TAB_ROOTS[pathname]) return TAB_ROOTS[pathname];
  // Detail pages belong to Dashboard tab
  if (["/ReceiptDetail", "/SessionHost", "/Claim"].some(p => pathname.startsWith(p))) return "Dashboard";
  return "Home";
}

const TabNavContext = createContext(null);

export function TabNavigationProvider({ children }) {
  // Per-tab stack: { [tabKey]: string[] }
  const [tabStacks, setTabStacks] = useState({
    Home: ["/Home"],
    Dashboard: ["/Dashboard"],
    NewReceipt: ["/NewReceipt"],
    Profile: ["/Profile"],
  });

  const navigate = useNavigate();
  const location = useLocation();

  // direction: "forward" | "back" | "tab"
  const directionRef = useRef("tab");

  const activeTab = getTabForPath(location.pathname);

  // Handle iOS swipe-back / browser back button — pop our stack instead of letting
  // the browser navigate away, so animations and stack state stay in sync.
  useEffect(() => {
    const handler = () => {
      const tab = getTabForPath(location.pathname);
      const stack = tabStacks[tab] || [];
      if (stack.length > 1) {
        const prev = stack[stack.length - 2];
        directionRef.current = "back";
        setTabStacks(s => ({ ...s, [tab]: s[tab].slice(0, -1) }));
        navigate(prev, { replace: true });
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [location.pathname, tabStacks, navigate]);

  const pushScreen = useCallback((path) => {
    const tab = getTabForPath(path);
    directionRef.current = "forward";
    setTabStacks(prev => {
      const stack = prev[tab] || [];
      // Don't duplicate top of stack
      if (stack[stack.length - 1] === path) return prev;
      return { ...prev, [tab]: [...stack, path] };
    });
    navigate(path);
  }, [navigate]);

  const popScreen = useCallback(() => {
    const tab = activeTab;
    const stack = tabStacks[tab] || [];
    if (stack.length <= 1) return false;
    const prev = stack[stack.length - 2];
    directionRef.current = "back";
    setTabStacks(s => ({ ...s, [tab]: s[tab].slice(0, -1) }));
    navigate(prev);
    return true;
  }, [activeTab, tabStacks, navigate]);

  const switchTab = useCallback((tabPath) => {
    directionRef.current = "tab";
    const tab = getTabForPath(tabPath);
    const stack = tabStacks[tab] || [tabPath];
    // Navigate to top of that tab's stack
    navigate(stack[stack.length - 1]);
  }, [tabStacks, navigate]);

  const canGoBack = (tabStacks[activeTab] || []).length > 1;

  return (
    <TabNavContext.Provider value={{ pushScreen, popScreen, switchTab, canGoBack, activeTab, directionRef }}>
      {children}
    </TabNavContext.Provider>
  );
}

export function useTabNav() {
  const ctx = useContext(TabNavContext);
  if (!ctx) throw new Error("useTabNav must be used inside TabNavigationProvider");
  return ctx;
}
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
  if (TAB_ROOTS[pathname]) return TAB_ROOTS[pathname];
  if (["/ReceiptDetail", "/SessionHost", "/Claim"].some(p => pathname.startsWith(p))) return "Dashboard";
  return "Home";
}

const TabNavContext = createContext(null);

export function TabNavigationProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const directionRef = useRef("tab");

  // Per-tab stacks keyed by tab name → string[]
  const tabStacksRef = useRef({
    Home: ["/Home"],
    Dashboard: ["/Dashboard"],
    NewReceipt: ["/NewReceipt"],
    Profile: ["/Profile"],
  });

  // Mirror as state so consumers re-render when canGoBack changes
  const [tabStacks, setTabStacks] = useState(tabStacksRef.current);

  const syncStacks = useCallback((next) => {
    tabStacksRef.current = next;
    setTabStacks(next);
  }, []);

  const activeTab = getTabForPath(location.pathname);

  // Sync our stack with the browser's History API popstate.
  // We use history.state to embed the stack so it survives full reloads / swipe-back.
  useEffect(() => {
    const handler = (e) => {
      // The browser has already moved to the previous history entry.
      // Restore stacks from the state we embedded there (if any).
      const restoredStacks = e.state?.tabStacks;
      if (restoredStacks) {
        const prev = restoredStacks;
        directionRef.current = "back";
        syncStacks(prev);
        // React Router's location will update via the popstate it also listens to.
      } else {
        // No embedded state — fall back to popping our in-memory stack.
        const tab = getTabForPath(location.pathname);
        const stack = tabStacksRef.current[tab] || [];
        if (stack.length > 1) {
          directionRef.current = "back";
          const next = { ...tabStacksRef.current, [tab]: stack.slice(0, -1) };
          syncStacks(next);
        }
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [location.pathname, syncStacks]);

  // Push a new screen, embedding the updated stacks into history.state.
  const pushScreen = useCallback((path) => {
    const tab = getTabForPath(path);
    const stack = tabStacksRef.current[tab] || [];
    if (stack[stack.length - 1] === path) return; // no-op if already on top
    directionRef.current = "forward";
    const next = { ...tabStacksRef.current, [tab]: [...stack, path] };
    syncStacks(next);
    navigate(path, { state: { tabStacks: next } });
  }, [navigate, syncStacks]);

  const popScreen = useCallback(() => {
    const tab = activeTab;
    const stack = tabStacksRef.current[tab] || [];
    if (stack.length <= 1) return false;
    directionRef.current = "back";
    const next = { ...tabStacksRef.current, [tab]: stack.slice(0, -1) };
    syncStacks(next);
    navigate(-1);
    return true;
  }, [activeTab, navigate, syncStacks]);

  const switchTab = useCallback((tabPath) => {
    directionRef.current = "tab";
    const tab = getTabForPath(tabPath);
    const stack = tabStacksRef.current[tab] || [tabPath];
    const dest = stack[stack.length - 1];
    navigate(dest, { state: { tabStacks: tabStacksRef.current } });
  }, [navigate]);

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
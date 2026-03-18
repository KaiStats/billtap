import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// Detect Android/Cordova environment
const isAndroid = () => {
  return /Android/i.test(navigator.userAgent) || 
         typeof window.cordova !== 'undefined' ||
         typeof window.phonegap !== 'undefined';
};

export const TAB_ROOTS = {
  "/Home": "Home",
  "/": "Home",
  "/Dashboard": "Dashboard",
  "/NewReceipt": "NewReceipt",
  "/Profile": "Profile",
};

const VALID_TABS = new Set(["Home", "Dashboard", "NewReceipt", "Profile"]);
const VALID_PATHS = /^\/[A-Za-z0-9_\-?=&%]+$/;

export function getTabForPath(pathname) {
  if (TAB_ROOTS[pathname]) return TAB_ROOTS[pathname];
  if (["/ReceiptDetail", "/SessionHost", "/Claim"].some(p => pathname.startsWith(p))) return "Dashboard";
  return "Home";
}

/** Validate that a restored tabStacks object from history.state is safe to use */
function isValidTabStacks(stacks) {
  if (!stacks || typeof stacks !== "object" || Array.isArray(stacks)) return false;
  for (const [tab, stack] of Object.entries(stacks)) {
    if (!VALID_TABS.has(tab)) return false;
    if (!Array.isArray(stack) || stack.length === 0) return false;
    if (!stack.every(p => typeof p === "string" && VALID_PATHS.test(p))) return false;
  }
  return true;
}

const DEFAULT_STACKS = {
  Home: ["/Home"],
  Dashboard: ["/Dashboard"],
  NewReceipt: ["/NewReceipt"],
  Profile: ["/Profile"],
};

const TabNavContext = createContext(null);

export function TabNavigationProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const directionRef = useRef("tab");

  const tabStacksRef = useRef({ ...DEFAULT_STACKS });
  const [tabStacks, setTabStacks] = useState(tabStacksRef.current);

  const syncStacks = useCallback((next) => {
    tabStacksRef.current = next;
    setTabStacks(next);
  }, []);

  const activeTab = getTabForPath(location.pathname);

  useEffect(() => {
    const handler = (e) => {
      const restoredStacks = e.state?.tabStacks;
      if (isValidTabStacks(restoredStacks)) {
        directionRef.current = "back";
        syncStacks(restoredStacks);
      } else {
        // Fallback: pop in-memory stack for the current tab
        const tab = getTabForPath(location.pathname);
        const stack = tabStacksRef.current[tab] || [];
        if (stack.length > 1) {
          directionRef.current = "back";
          syncStacks({ ...tabStacksRef.current, [tab]: stack.slice(0, -1) });
        }
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [location.pathname, syncStacks]);

  // Android hardware back button support
  useEffect(() => {
    if (!isAndroid()) return;

    // Handle Cordova backbutton event (for Capacitor/Cordova apps)
    const handleCordovaBack = () => {
      const stack = tabStacksRef.current[activeTab] || [];
      if (stack.length > 1) {
        // Pop the current screen within the tab
        directionRef.current = "back";
        syncStacks({ ...tabStacksRef.current, [activeTab]: stack.slice(0, -1) });
        navigate(-1);
      } else {
        // At root of tab—switch to Home or minimize app
        if (activeTab !== "Home") {
          directionRef.current = "tab";
          navigate("/Home", { state: { tabStacks: tabStacksRef.current } });
        }
        // Otherwise let system handle (close app)
      }
    };

    // Cordova/Capacitor back button
    if (window.document.addEventListener && typeof window.cordova !== 'undefined') {
      window.document.addEventListener('backbutton', handleCordovaBack, false);
    }

    // Generic keydown for testing/web fallback
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || (e.keyCode === 27)) {
        // Allow testing Android back behavior in browser dev tools
        const stack = tabStacksRef.current[activeTab] || [];
        if (stack.length > 1) {
          e.preventDefault();
          handleCordovaBack();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      if (typeof window.cordova !== 'undefined') {
        window.document.removeEventListener('backbutton', handleCordovaBack, false);
      }
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeTab, navigate, syncStacks]);

  const pushScreen = useCallback((path) => {
    const tab = getTabForPath(path);
    const stack = tabStacksRef.current[tab] || [];
    if (stack[stack.length - 1] === path) return;
    directionRef.current = "forward";
    const next = { ...tabStacksRef.current, [tab]: [...stack, path] };
    syncStacks(next);
    navigate(path, { state: { tabStacks: next } });
  }, [navigate, syncStacks]);

  const popScreen = useCallback(() => {
    const stack = tabStacksRef.current[activeTab] || [];
    if (stack.length <= 1) return false;
    directionRef.current = "back";
    syncStacks({ ...tabStacksRef.current, [activeTab]: stack.slice(0, -1) });
    navigate(-1);
    return true;
  }, [activeTab, navigate, syncStacks]);

  const switchTab = useCallback((tabPath) => {
    directionRef.current = "tab";
    const tab = getTabForPath(tabPath);
    const stack = tabStacksRef.current[tab] || [tabPath];
    navigate(stack[stack.length - 1], { state: { tabStacks: tabStacksRef.current } });
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
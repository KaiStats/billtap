import { useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { AnimatePresence, motion } from 'framer-motion';
import BottomNav from '@/components/BottomNav';
import ThemeProvider from '@/components/ThemeProvider';
import { TabNavigationProvider, useTabNav } from '@/lib/TabNavigationContext';
import MutationErrorToast from '@/components/MutationErrorToast';
import AuthLoadingSkeleton from '@/components/AuthLoadingSkeleton';
import Home from '@/pages/Home';
import { useScrollBehavior } from '@/hooks/useScrollBehavior';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { handleDeepLink } from '@/lib/deepLinking';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : () => null;

const LayoutWrapper = ({ children, currentPageName }) => (Layout && typeof Layout === 'function') ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AnimatedPage = ({ children, direction }) => {
  const xIn = direction === "back" ? -30 : direction === "tab" ? 0 : 30;
  const xOut = direction === "back" ? 30 : direction === "tab" ? 0 : -30;
  const opacityOnly = direction === "tab";

  return (
    <motion.div
      initial={{ opacity: 0, x: opacityOnly ? 0 : xIn }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: opacityOnly ? 0 : xOut }}
      transition={{
        duration: direction === "tab" ? 0.15 : 0.2,
        ease: direction === "tab" ? "easeInOut" : "easeInOut",
        when: "beforeChildren",
      }}
      className="w-full"
    >
      {children}
    </motion.div>
  );
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const location = useLocation();
  const { directionRef, pushScreen } = useTabNav();
  
  // Disable overscroll bounce on mobile WebViews
  useScrollBehavior();
  
  // Global offline detector
  useNetworkStatus();

  // Handle deep linking (direct navigation via URI params)
  useEffect(() => {
    if (!location.pathname || location.pathname === '/') return;
    
    const deepLink = handleDeepLink(location);
    if (deepLink.state && deepLink.state.sessionId) {
      // Store state for destination component
      sessionStorage.setItem('deepLinkState', JSON.stringify(deepLink.state));
    }
  }, [location]);

  if (isLoadingPublicSettings || isLoadingAuth) {
    return <AuthLoadingSkeleton />;
  }

  if (authError) {
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
    if (authError.type === 'auth_required') { navigateToLogin(); return null; }
  }

  const direction = directionRef.current;

  return (
    <div className="flex flex-col min-h-screen">
      <AnimatePresence mode="wait" onExitComplete={() => null}>
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={
            <AnimatedPage direction={direction}>
              <LayoutWrapper currentPageName="Home"><Home /></LayoutWrapper>
            </AnimatedPage>
          } />
          <Route path="/Home" element={
            <AnimatedPage direction={direction}>
              <LayoutWrapper currentPageName="Home"><Home /></LayoutWrapper>
            </AnimatedPage>
          } />
          {Object.entries(Pages).map(([path, Page]) => (
            <Route key={path} path={`/${path}`} element={
              <AnimatedPage direction={direction}>
                <LayoutWrapper currentPageName={path}><Page /></LayoutWrapper>
              </AnimatedPage>
            } />
          ))}
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </AnimatePresence>
      <BottomNav />
    </div>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <TabNavigationProvider>
              <AuthenticatedApp />
            </TabNavigationProvider>
          </Router>
          <MutationErrorToast />
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App
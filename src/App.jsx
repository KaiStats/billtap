import { useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config.jsx'
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
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import Home from '@/pages/Home';
import LandingPage from '@/pages/LandingPage';
import IconGenerator from '@/pages/IconGenerator';
import Privacy from '@/pages/Privacy';
import Terms from '@/pages/Terms';
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

  // Track page views with device type
  useEffect(() => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', {
        page_path: location.pathname,
        device_type: isMobile ? 'mobile' : 'desktop',
      });
    }
  }, [location.pathname]);
  
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
          <Route path="/LandingPage" element={
            <AnimatedPage direction={direction}>
              <LandingPage />
            </AnimatedPage>
          } />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/icon-generator" element={<IconGenerator />} />
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
      <PWAInstallPrompt />
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
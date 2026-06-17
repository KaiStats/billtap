import { useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config.jsx'
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ProtectedRoute from '@/components/ProtectedRoute';
import { AnimatePresence, motion } from 'framer-motion';
import BottomNav from '@/components/BottomNav';
import ThemeProvider from '@/components/ThemeProvider';
import { TabNavigationProvider, useTabNav } from '@/lib/TabNavigationContext';
import MutationErrorToast from '@/components/MutationErrorToast';
import AuthLoadingSkeleton from '@/components/AuthLoadingSkeleton';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import { lazy, Suspense } from 'react';
const Home        = lazy(() => import('@/pages/Home'));
const Landing     = lazy(() => import('@/pages/Landing'));
const IconGenerator = lazy(() => import('@/pages/IconGenerator'));
const Privacy     = lazy(() => import('@/pages/Privacy'));
const Terms       = lazy(() => import('@/pages/Terms'));
const Claim       = lazy(() => import('@/pages/Claim'));
const NewReceipt  = lazy(() => import('@/pages/NewReceipt'));
const Dashboard   = lazy(() => import('@/pages/Dashboard'));
const SessionHost = lazy(() => import('@/pages/SessionHost'));
const ReceiptDetail = lazy(() => import('@/pages/ReceiptDetail'));
const About       = lazy(() => import('@/pages/About'));
const Blog        = lazy(() => import('@/pages/Blog'));
const Changelog   = lazy(() => import('@/pages/Changelog'));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0e1a' }}>
    <div className="flex flex-col items-center gap-3">
      <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: '#00c896' }}>
        <span className="text-white font-black text-lg">B</span>
      </div>
      <div className="flex gap-1.5">
        {[0,1,2].map(i => (
          <div key={i} className="w-2 h-2 rounded-full" style={{ background: '#00c896', animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />
        ))}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  </div>
);
import { useScrollBehavior } from '@/hooks/useScrollBehavior';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { handleDeepLink } from '@/lib/deepLinking';
import { Navigate } from 'react-router-dom';

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
  }

  const direction = directionRef.current;
  const hideNav = ['/', '/privacy', '/terms', '/icon-generator'].includes(location.pathname);

  return (
    <div className="flex flex-col min-h-screen">
      <Suspense fallback={<PageLoader />}>
        <AnimatePresence mode="wait" onExitComplete={() => null}>
          <Routes location={location} key={location.pathname}>
            {/* Public routes */}
            <Route path="/" element={
              <AnimatedPage direction={direction}>
                <Landing />
              </AnimatedPage>
            } />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/icon-generator" element={<IconGenerator />} />
            <Route path="/About" element={<About />} />
            <Route path="/Blog" element={<Blog />} />
            <Route path="/Changelog" element={<Changelog />} />
            <Route path="/Claim" element={
              <AnimatedPage direction={direction}>
                <Claim />
              </AnimatedPage>
            } />

            {/* Protected host routes */}
            <Route element={
              <ProtectedRoute unauthenticatedElement={<Navigate to="/LandingPage" replace />} />
            }>
              <Route path="/Home" element={
                <AnimatedPage direction={direction}>
                  <LayoutWrapper currentPageName="Home"><Home /></LayoutWrapper>
                </AnimatedPage>
              } />
              <Route path="/NewReceipt" element={
                <AnimatedPage direction={direction}>
                  <LayoutWrapper currentPageName="NewReceipt"><NewReceipt /></LayoutWrapper>
                </AnimatedPage>
              } />
              <Route path="/Dashboard" element={
                <AnimatedPage direction={direction}>
                  <LayoutWrapper currentPageName="Dashboard"><Dashboard /></LayoutWrapper>
                </AnimatedPage>
              } />
              <Route path="/SessionHost" element={
                <AnimatedPage direction={direction}>
                  <LayoutWrapper currentPageName="SessionHost"><SessionHost /></LayoutWrapper>
                </AnimatedPage>
              } />
              <Route path="/ReceiptDetail" element={
                <AnimatedPage direction={direction}>
                  <LayoutWrapper currentPageName="ReceiptDetail"><ReceiptDetail /></LayoutWrapper>
                </AnimatedPage>
              } />
            </Route>

            {/* Pages from config (protected by default) */}
            {Object.entries(Pages).filter(([path]) =>
              !['Claim', 'LandingPage', 'Privacy', 'Terms', 'IconGenerator'].includes(path)
            ).map(([path, Page]) => (
              <Route key={path} path={`/${path}`} element={
                <ProtectedRoute unauthenticatedElement={<Navigate to="/LandingPage" replace />}>
                  <AnimatedPage direction={direction}>
                    <LayoutWrapper currentPageName={path}><Page /></LayoutWrapper>
                  </AnimatedPage>
                </ProtectedRoute>
              } />
            ))}
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </AnimatePresence>
      </Suspense>
      {!hideNav && <BottomNav />}
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
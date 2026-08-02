import { useEffect, lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { BrowserRouter as Router, Route, Routes, useLocation, Navigate } from 'react-router-dom';
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
import { useScrollBehavior } from '@/hooks/useScrollBehavior';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { handleDeepLink } from '@/lib/deepLinking';

const Home        = lazy(() => import('@/pages/Home'));
const Landing     = lazy(() => import('@/pages/Landing'));
const Restaurants = lazy(() => import('@/pages/Restaurants'));
const TableEntry  = lazy(() => import('@/pages/TableEntry'));
const RestaurantDashboard = lazy(() => import('@/pages/RestaurantDashboard'));
const Login       = lazy(() => import('@/pages/Login'));
const Register    = lazy(() => import('@/pages/Register'));
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
const Profile     = lazy(() => import('@/pages/Profile'));

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
        ease: "easeInOut",
        when: "beforeChildren",
      }}
      className="w-full"
    >
      {children}
    </motion.div>
  );
};

/**
 * Routes that genuinely cannot render before we know who the user is. Everything
 * else — the marketing pages, the guest /r/<slug> flow, auth screens — paints
 * immediately and lets auth resolve underneath.
 *
 * Mirrors the ProtectedRoute block below; keep the two in step.
 */
const AUTH_GATED_ROUTES = new Set([
  '/home',
  // Not /new-receipt: a guest arriving from a table tent has no account, and
  // gating it would make them wait on an auth round-trip only to be bounced.
  '/dashboard',
  // Neither /session-host nor /receipt-detail: both are host screens for a
  // split that may have been created by someone with no account at all.
  // Not /receipt-detail: the host of a table-tent split has no account, and
  // that is the screen where payments get confirmed. See the route itself for
  // why opening it is safe.
  '/profile',
  '/restaurant-dashboard',
]);

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();
  const location = useLocation();
  const { directionRef } = useTabNav();

  useScrollBehavior();
  useNetworkStatus();

  useEffect(() => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', {
        page_path: location.pathname,
        device_type: isMobile ? 'mobile' : 'desktop',
      });
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!location.pathname || location.pathname === '/') return;
    const deepLink = handleDeepLink(location);
    if (deepLink.state && deepLink.state.sessionId) {
      sessionStorage.setItem('deepLinkState', JSON.stringify(deepLink.state));
    }
  }, [location]);

  // Only the signed-in surface waits on auth.
  //
  // This gate used to be unconditional, which meant every public page —
  // including /restaurants, where the ads land — rendered a loading skeleton
  // until base44.auth.me() came back. For an anonymous visitor that call is
  // guaranteed to fail, so the landing page's first paint was blocked on a
  // round-trip whose only possible outcome was 401.
  //
  // Nothing is lost by dropping it here: ProtectedRoute already returns its own
  // fallback while isLoadingAuth is true, and Dashboard, Home, Profile and
  // SessionHost each check the flag themselves. This is belt-and-braces that
  // only ever charged the pages which do not need it.
  if ((isLoadingPublicSettings || isLoadingAuth) && AUTH_GATED_ROUTES.has(location.pathname)) {
    return <AuthLoadingSkeleton />;
  }

  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  const direction = directionRef.current;

  return (
    <div className="flex flex-col min-h-screen">
      <Suspense fallback={<PageLoader />}>
        <AnimatePresence mode="wait" onExitComplete={() => null}>
          <Routes location={location} key={location.pathname}>
            {/* Public routes */}
            <Route path="/" element={<AnimatedPage direction={direction}><Landing /></AnimatedPage>} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/icon-generator" element={<IconGenerator />} />
            <Route path="/about" element={<About />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/changelog" element={<Changelog />} />
            <Route path="/claim" element={<AnimatedPage direction={direction}><Claim /></AnimatedPage>} />
            <Route path="/new-receipt" element={<AnimatedPage direction={direction}><NewReceipt /></AnimatedPage>} />
            {/*
              Not protected, for the same reason /new-receipt is not.

              This is where the host confirms that each diner's money arrived. A
              split started from a restaurant's table tent is created by someone
              with no account — that is the product's premise — so gating this
              route sent the host to /login and left them unable to reach the one
              screen that settles their bill. Everyone at the table could pay;
              nobody could ever be recorded as having paid.

              Safe to open because the authorization moved to where it belongs.
              getSessionAsHost and confirmPayment each demand the host key minted
              at creation, or proven ownership, and answer 403 without it. An
              anonymous visitor holding only a session id falls through to an
              ordinary entity read, which Base44's rules answer with nothing.
            */}
            <Route path="/receipt-detail" element={<AnimatedPage direction={direction}><ReceiptDetail /></AnimatedPage>} />
            {/*
              Open for the same reason. This is where the QR code lives, and the
              host of a table-tent split has no account — so gating it left them
              holding a split that nobody could be invited to join, and no way
              to enter the payment handle the whole table was meant to send
              money to. generateQRSignature and updateSplitSettings both demand
              the host key and answer 403 without it.
            */}
            <Route path="/session-host" element={<AnimatedPage direction={direction}><SessionHost /></AnimatedPage>} />
            <Route path="/restaurants" element={<Restaurants />} />
            <Route path="/r/:slug" element={<TableEntry />} />

            {/* Auth routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Legacy capitalized redirects */}
            <Route path="/About" element={<Navigate to="/about" replace />} />
            <Route path="/Blog" element={<Navigate to="/blog" replace />} />
            <Route path="/Changelog" element={<Navigate to="/changelog" replace />} />
            <Route path="/Claim" element={<Navigate to="/claim" replace />} />
            <Route path="/Restaurants" element={<Navigate to="/restaurants" replace />} />
            <Route path="/Home" element={<Navigate to="/home" replace />} />
            <Route path="/NewReceipt" element={<Navigate to="/new-receipt" replace />} />
            <Route path="/Dashboard" element={<Navigate to="/dashboard" replace />} />
            <Route path="/SessionHost" element={<Navigate to="/session-host" replace />} />
            <Route path="/ReceiptDetail" element={<Navigate to="/receipt-detail" replace />} />
            <Route path="/Profile" element={<Navigate to="/profile" replace />} />

            {/* Protected host routes */}
            <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
              <Route path="/home" element={<AnimatedPage direction={direction}><Home /></AnimatedPage>} />
              <Route path="/dashboard" element={<AnimatedPage direction={direction}><Dashboard /></AnimatedPage>} />
              <Route path="/profile" element={<AnimatedPage direction={direction}><Profile /></AnimatedPage>} />
              <Route path="/restaurant-dashboard" element={<RestaurantDashboard />} />
            </Route>

            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </AnimatePresence>
      </Suspense>
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

export default App;
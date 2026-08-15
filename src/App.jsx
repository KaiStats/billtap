import { useEffect, lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { BrowserRouter as Router, Route, Routes, useLocation, Navigate, useParams } from 'react-router';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ProtectedRoute from '@/components/ProtectedRoute';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import BottomNav from '@/components/BottomNav';
import ThemeProvider from '@/components/ThemeProvider';
import { TabNavigationProvider, useTabNav } from '@/lib/TabNavigationContext';
import MutationErrorToast from '@/components/MutationErrorToast';
import AuthLoadingSkeleton from '@/components/AuthLoadingSkeleton';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import EnvironmentBadge from '@/components/EnvironmentBadge';
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
const Security    = lazy(() => import('@/pages/Security'));
const Claim       = lazy(() => import('@/pages/Claim'));
const NewReceipt  = lazy(() => import('@/pages/NewReceipt'));
const Dashboard   = lazy(() => import('@/pages/Dashboard'));
const SessionHost = lazy(() => import('@/pages/SessionHost'));
const ReceiptDetail = lazy(() => import('@/pages/ReceiptDetail'));
const About       = lazy(() => import('@/pages/About'));
const Blog        = lazy(() => import('@/pages/Blog'));
const BlogPost01PodiumAlternative = lazy(() => import('@/pages/BlogPost01PodiumAlternative'));
const BlogPost02Catch1StarEarly = lazy(() => import('@/pages/BlogPost02Catch1StarEarly'));
const BlogPost03QRWithoutPOS = lazy(() => import('@/pages/BlogPost03QRWithoutPOS'));
const BlogPost04CostOfOneLostRegular = lazy(() => import('@/pages/BlogPost04CostOfOneLostRegular'));
const Changelog   = lazy(() => import('@/pages/Changelog'));
const Profile     = lazy(() => import('@/pages/Profile'));
const NewDemo     = lazy(() => import('@/pages/NewDemo'));

/**
 * `/f/<slug>` → `/r/<slug>`, keeping whatever was on the query string.
 *
 * The cards carry the right slug and the wrong letter in front of it. Rendered
 * rather than redirected in a router config because the slug has to be read
 * from the path and handed to the destination, and `useParams` is the thing
 * that knows it.
 */
const PrintedTentRedirect = () => {
  const { slug } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/r/${slug}${search}`} replace />;
};

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ background: '#070b16' }}>
    <div className="flex flex-col items-center gap-3.5">
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: '#00c896', boxShadow: '0 12px 40px -8px rgba(0,200,150,0.5)' }}>
        <span className="font-black text-lg" style={{ color: '#04140f' }}>B</span>
      </div>
      <div className="flex gap-1.5">
        {[0,1,2].map(i => (
          <div key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: '#00c896', animation: `pulse 1.2s cubic-bezier(0.23,1,0.32,1) ${i*0.2}s infinite` }} />
        ))}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  </div>
);

/** @param {{ children?: any, direction?: any, [key: string]: any }} props */
const AnimatedPage = ({ children, direction }) => {
  /**
   * src/index.css has honoured `prefers-reduced-motion: reduce` since it was
   * written — but only for CSS animations and transitions. Every page transition
   * in this app is a framer-motion transform driven from JavaScript, which that
   * media query cannot touch. So a diner who has switched motion off at the OS
   * level, often because movement makes them ill, was still getting a 30px
   * horizontal slide on every single navigation.
   *
   * useReducedMotion() reads the same media query and stays subscribed to it.
   * Reduced means no travel — the cross-fade stays, because an instantaneous
   * swap loses the "this is a new screen" cue that the movement was there to
   * give, and a pure opacity change is not what the setting is asking to remove.
   */
  const reduceMotion = useReducedMotion();

  const xIn = direction === "back" ? -30 : direction === "tab" ? 0 : 30;
  const xOut = direction === "back" ? 30 : direction === "tab" ? 0 : -30;
  const opacityOnly = direction === "tab" || reduceMotion;

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
  // Not /dashboard: it shows a guest the splits recorded on their own phone.
  // Neither /session-host nor /receipt-detail: both are host screens for a
  // split that may have been created by someone with no account at all.
  // Not /receipt-detail: the host of a table-tent split has no account, and
  // that is the screen where payments get confirmed. See the route itself for
  // why opening it is safe.
  '/profile',
  '/restaurant-dashboard',
  // The demo tool. Gated because it is only ever opened by a signed-in
  // operator, and a flash of the create form at a signed-out visitor is a
  // flash of a screen that publishes pages in the name of a business that has
  // not agreed to one.
  '/new',
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
      {/*
        Skip link, and the <main> it points at.

        Neither existed. Every route rendered as anonymous <div>s inside another
        <div> — the only <main> element in the tree was in ui/sidebar.jsx, which
        nothing imports. So a screen-reader user had no landmark to jump to and
        no way to hear where the page content began, and a keyboard user hit
        every item in BottomNav and every header control before reaching the
        receipt they came to split. That is WCAG 2.4.1 (Bypass Blocks) and
        1.3.1, and it applied to all 22 routes.

        Done once here rather than page by page, because that is what puts it on
        routes nobody remembers to update.

        Visually hidden until focused: `sr-only` collapses it to a 1px clip,
        `focus:not-sr-only` restores it, so a sighted keyboard user sees it on
        the first Tab and a mouse user never does. tabIndex={-1} on <main> lets
        it receive programmatic focus from the link without entering the tab
        order itself.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:px-4 focus:py-2 focus:font-semibold"
        style={{ background: '#00c896', color: '#0a0e1a' }}
      >
        Skip to main content
      </a>
      <main id="main-content" tabIndex={-1} className="w-full">
      <Suspense fallback={<PageLoader />}>
        <AnimatePresence mode="wait" onExitComplete={() => null}>
          <Routes location={location} key={location.pathname}>
            {/* Public routes */}
            <Route path="/" element={<AnimatedPage direction={direction}><Landing /></AnimatedPage>} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/security" element={<Security />} />
            <Route path="/icon-generator" element={<IconGenerator />} />
            <Route path="/about" element={<About />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/podium-alternative" element={<BlogPost01PodiumAlternative />} />
            <Route path="/blog/catch-1-star-early" element={<BlogPost02Catch1StarEarly />} />
            <Route path="/blog/qr-without-pos-change" element={<BlogPost03QRWithoutPOS />} />
            <Route path="/blog/cost-of-one-lost-regular" element={<BlogPost04CostOfOneLostRegular />} />
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
            {/*
              Open too. The landing page promises a bill history, and a guest
              has no account for Base44 to key one off — so this screen used to
              answer the product's primary user by replacing the page with the
              landing page. It now reads the local index in
              src/lib/splitHistory.js and re-checks those splits through the
              scoped endpoints, which return a diner their own share and nobody
              else's.
            */}
            <Route path="/dashboard" element={<AnimatedPage direction={direction}><Dashboard /></AnimatedPage>} />
            <Route path="/restaurants" element={<Restaurants />} />
            <Route path="/r/:slug" element={<TableEntry />} />
            {/*
              The prefix a batch of printed cards used by mistake.

              The edge handles this with a 301 — see PRINT_PREFIX_REDIRECT in
              worker/index.js, which is the one that matters, because a phone
              scanning a QR code never reaches React until the Worker has
              already answered. This covers the two places nothing sits in
              front of the SPA: the dev server, and navigation inside the app
              once it has booted.

              `replace` so the broken URL does not sit in history behind the
              working one, waiting for a back button.
            */}
            <Route path="/f/:slug" element={<PrintedTentRedirect />} />

            {/* Auth routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            {/*
              Login.jsx has linked to /forgot-password since it was written and
              the route never existed, so forgetting a password ended at a 404.
              /reset-password is where the emailed link lands — it must be a
              real route at the edge as well, or the Worker answers that deep
              link with a 404 before React ever loads. See SPA_ROUTES in
              worker/index.js.
            */}
            {/*
              Kept as redirects, not removed. Both paths are in Base44's old
              reset emails and in people's history, and a 404 is a worse answer
              than the sign-in screen for somebody who is trying to get in.
              There is nothing to reset any more — see src/pages/Login.jsx.
            */}
            <Route path="/forgot-password" element={<Navigate to="/login" replace />} />
            <Route path="/reset-password" element={<Navigate to="/login" replace />} />

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
              <Route path="/profile" element={<AnimatedPage direction={direction}><Profile /></AnimatedPage>} />
              <Route path="/restaurant-dashboard" element={<RestaurantDashboard />} />
              {/*
                The demo tool. Deliberately not linked from any page — see
                src/pages/NewDemo.jsx. Sitting under ProtectedRoute is a
                convenience so an unauthenticated visitor lands on /login
                instead of a form that cannot work; the control that matters is
                the operator allowlist in worker/routes/functions.js, which
                answers 403 to every signed-in user who is not on it.
              */}
              <Route path="/new" element={<NewDemo />} />
            </Route>

            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </AnimatePresence>
      </Suspense>
      </main>
      <BottomNav />
      <PWAInstallPrompt />
      {/* Renders nothing in production. Everywhere else it is the only thing on
          screen that distinguishes a test bill from a real restaurant's. */}
      <EnvironmentBadge />
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
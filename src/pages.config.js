/**
 * pages.config.js - Page routing configuration
 * Lazy-loads all pages for better initial load performance.
 */
import { lazy, Suspense } from 'react';
import PageFallback from './components/PageFallback';

const withSuspense = (Component) => (props) => (
  <Suspense fallback={<PageFallback />}>
    <Component {...props} />
  </Suspense>
);

const Claim         = withSuspense(lazy(() => import('./pages/Claim')));
const Dashboard     = withSuspense(lazy(() => import('./pages/Dashboard')));
const Home          = withSuspense(lazy(() => import('./pages/Home')));
const NewReceipt    = withSuspense(lazy(() => import('./pages/NewReceipt')));
const ReceiptDetail = withSuspense(lazy(() => import('./pages/ReceiptDetail')));
const SessionHost   = withSuspense(lazy(() => import('./pages/SessionHost')));
const Profile       = withSuspense(lazy(() => import('./pages/Profile')));

export const PAGES = {
  "Claim":         Claim,
  "Dashboard":     Dashboard,
  "Home":          Home,
  "NewReceipt":    NewReceipt,
  "ReceiptDetail": ReceiptDetail,
  "SessionHost":   SessionHost,
  "Profile":       Profile,
};

export const pagesConfig = {
  mainPage: "Home",
  Pages: PAGES,
};
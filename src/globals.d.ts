/**
 * Globals this app genuinely uses, declared so the type checker knows about
 * them.
 *
 * Twenty-four of the type errors were `Property 'gtag' does not exist on type
 * 'Window & typeof globalThis'` and its relatives. None of them were bugs —
 * every call site already guards with `typeof window.gtag === 'function'`,
 * because these are third-party tags that an ad blocker removes and the app has
 * to keep working without. What was missing was the declaration, and the noise
 * from it is a large part of why `npm run typecheck` was never wired into CI.
 *
 * Declared as optional on purpose. `gtag?:` rather than `gtag:` keeps the
 * existing guards meaningful — with a non-optional declaration the checker
 * would start telling people those checks are redundant, and they are not: on a
 * phone with a content blocker, which is most of them, these are undefined.
 */

interface Window {
  /**
   * Google tag, loaded by public/analytics.js. Absent when the tag is blocked.
   */
  gtag?: (...args: unknown[]) => void;

  /**
   * Meta Pixel, same file, same caveat.
   */
  fbq?: (...args: unknown[]) => void;

  /** Pushed to by the Google tag before gtag() itself is defined. */
  dataLayer?: unknown[];

  /**
   * Present only inside the Android wrapper.
   *
   * src/lib/TabNavigationContext.jsx uses it to tell a hardware back button
   * from a browser one — see src/ANDROID_INTEGRATION.md. Undefined in every
   * ordinary browser, which is the common case.
   */
  cordova?: unknown;

  /**
   * Chromium's install prompt. src/components/PWAInstallPrompt.jsx captures the
   * beforeinstallprompt event and keeps the event object here.
   */
  deferredPrompt?: unknown;
}

/**
 * The Network Information API. src/main.jsx reports effectiveType to Sentry so
 * a bug filed from a restaurant's wifi can be told from one on a good
 * connection. Optional because Safari does not implement it.
 */
interface Navigator {
  connection?: { effectiveType?: string, downlink?: number, rtt?: number };
}

/**
 * Vite's build-time replacements.
 *
 * Only the variables this app actually reads. Listing them rather than widening
 * to a string index means a typo in a variable name is a type error instead of
 * `undefined` at runtime — which is the failure that put an `app_` prefixed id
 * into the frontend config and 404'd every API call while the prerendered pages
 * carried on looking healthy.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_ENVIRONMENT?: string;
  readonly VITE_BASE44_APP_ID?: string;
  readonly VITE_DISABLE_PWA?: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * The build's release name, replaced at build time by vite.config.js `define`.
 *
 * Declared rather than read from import.meta.env because it is not an env var —
 * it is one expression in the build config, used twice: here, and by the plugin
 * that uploads the sourcemaps. A release that does not match the one the maps
 * were uploaded under is the usual reason a Sentry stack trace stays minified
 * on a project that looks correctly configured.
 */
declare const __SENTRY_RELEASE__: string;

/**
 * Deep linking support for direct navigation to specific screens via URI
 * Supports both web routes and app-specific URI schemes
 * 
 * Examples:
 * - /SessionHost?sessionId=abc123
 * - /Claim?sessionId=abc123
 * - billtap://session/abc123
 * - billtap://claim/abc123
 */

const ROUTE_MAP = {
  home: '/Home',
  dashboard: '/Dashboard',
  newsplit: '/NewReceipt',
  profile: '/Profile',
  receipt: '/ReceiptDetail',
  session: '/SessionHost',
  claim: '/Claim',
};

const PARAM_MAP = {
  'sessionId': 'sessionId',
  'session_id': 'sessionId',
  'sid': 'sessionId',
  'receiptId': 'receiptId',
  'receipt_id': 'receiptId',
  'rid': 'receiptId',
};

/**
 * Parse custom URI scheme (billtap://)
 * Examples:
 *  billtap://session/123
 *  billtap://claim/abc?name=John
 */
export function parseCustomURI(uri) {
  const url = new URL(uri);
  if (url.protocol !== 'billtap:') return null;

  const [_empty, screen, id] = url.pathname.split('/');
  const route = ROUTE_MAP[screen?.toLowerCase()];

  if (!route) return null;

  const params = Object.fromEntries(url.searchParams);
  return { route, params: { ...params, sessionId: id || params.sessionId } };
}

/**
 * Parse standard web URI with query parameters
 * Examples:
 *  /SessionHost?sessionId=123
 *  /Claim?sessionId=abc&name=John
 */
export function parseWebURI(pathname, search) {
  const params = new URLSearchParams(search);
  const normalizedParams = {};

  // Normalize parameter names
  for (const [key, value] of params) {
    const normalized = PARAM_MAP[key] || key;
    normalizedParams[normalized] = value;
  }

  return { route: pathname, params: normalizedParams };
}

/**
 * Generate deep link URI for sharing
 * mode: 'web' | 'custom'
 */
export function generateDeepLink(screen, params = {}, mode = 'web') {
  const route = ROUTE_MAP[screen?.toLowerCase()] || `/${screen}`;

  if (mode === 'custom') {
    const baseUri = `billtap://${screen}`;
    const paramsStr = new URLSearchParams(params).toString();
    return paramsStr ? `${baseUri}?${paramsStr}` : baseUri;
  }

  // Web mode (default)
  const paramsStr = new URLSearchParams(params).toString();
  return paramsStr ? `${route}?${paramsStr}` : route;
}

/**
 * Handle navigation based on deep link
 * Returns { route, state } for router navigation
 */
export function handleDeepLink(location) {
  const { pathname, search } = location;

  // Try custom URI first (if somehow it gets here)
  if (pathname.startsWith('billtap://')) {
    const parsed = parseCustomURI(pathname);
    if (parsed) return parsed;
  }

  // Parse web URI
  const { route, params } = parseWebURI(pathname, search);

  // Convert params to navigation state
  const state = {};
  if (params.sessionId) state.sessionId = params.sessionId;
  if (params.receiptId) state.receiptId = params.receiptId;
  if (params.name) state.name = params.name;

  return { route, params, state };
}

/**
 * Register custom URI scheme handler
 * Mobile apps would use this to handle billtap:// links
 */
export function registerCustomURIHandler(callback) {
  // For web, this would be handled via intent filters on Android
  // or Universal Links on iOS when app is installed as PWA

  // Listen for custom events that might be dispatched by native bridges
  window.addEventListener('billtap-uri', (event) => {
    const parsed = parseCustomURI(event.detail.uri);
    if (parsed) callback(parsed);
  });
}

/**
 * Share deep link (web version)
 * For native apps, use app-specific sharing methods
 */
export async function shareDeepLink(screen, params = {}, title = 'BillTap') {
  const url = `${window.location.origin}${generateDeepLink(screen, params, 'web')}`;

  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return true;
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Share failed:', err);
      return false;
    }
  }

  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    return false;
  }
}
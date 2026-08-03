/**
 * "Was this done on a phone or a laptop", for the handful of actions where the
 * answer changes what we would build next.
 *
 * Through gtag rather than Base44's analytics. The app already reports
 * receipt_scanned, session_created and guest_joined this way from the call
 * sites, so this was a second analytics vendor collecting a subset of the same
 * events into somewhere nobody looked.
 *
 * Silent when gtag is absent — no consent yet, an ad blocker, a test run. An
 * analytics call must never be the thing that breaks claiming an item.
 */

function getDeviceType() {
  const ua = navigator.userAgent;
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return 'tablet';
  if (/iPhone|iPod|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function trackDeviceAction(action) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', action, {
    device_type: getDeviceType(),
  });
}

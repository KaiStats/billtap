import { base44 } from '@/api/base44Client';

function getDeviceType() {
  const ua = navigator.userAgent;
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return 'tablet';
  if (/iPhone|iPod|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function trackDeviceAction(action) {
  base44.analytics.track({
    eventName: action,
    properties: {
      device_type: getDeviceType(),
      timestamp: Date.now(),
    },
  });
}
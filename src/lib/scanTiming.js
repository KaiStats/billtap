import * as Sentry from "@sentry/react";

/**
 * How long a receipt scan actually took, phase by phase.
 *
 * "Scanning takes too long" has been the standing complaint about this product,
 * and nobody could say which part was slow — compressing, uploading, or the
 * model. Every attempt to fix it was therefore a guess, including the first few.
 * This makes the next conversation about numbers.
 *
 * Reported three ways, because each answers a different question:
 *   - console.table in development, for the person changing the code
 *   - a Sentry breadcrumb, so a slow scan that later errors carries its timings
 *   - a gtag event with the phase durations, for the distribution across real
 *     restaurants rather than one laptop on good wifi
 *
 * Deliberately cheap: Date.now() and one event at the end. Instrumentation that
 * slows down the thing it is measuring is worse than none.
 */
export function startScanTimer() {
  const marks = [];
  let last = Date.now();
  const started = last;

  return {
    /** Close off a phase and name it. */
    mark(phase) {
      const now = Date.now();
      marks.push({ phase, ms: now - last });
      last = now;
    },

    /**
     * @param detail  anything worth knowing alongside the timings — the
     *                compression result, how many items came back.
     */
    finish(detail = {}) {
      const total = Date.now() - started;
      const phases = Object.fromEntries(marks.map((m) => [m.phase, m.ms]));

      if (import.meta.env.DEV) {
        console.table([{ total_ms: total, ...phases, ...flatten(detail) }]);
      }

      Sentry.addBreadcrumb({
        category: 'scan',
        message: `receipt scan ${total}ms`,
        level: total > 12000 ? 'warning' : 'info',
        data: { total_ms: total, ...phases, ...flatten(detail) },
      });

      if (typeof window.gtag === 'function') {
        window.gtag('event', 'receipt_scan_timing', {
          total_ms: total,
          ...phases,
          ...flatten(detail),
        });
      }

      return { total_ms: total, phases };
    },
  };
}

/** gtag and Sentry both want flat values, not nested objects. */
function flatten(detail) {
  const out = {};
  for (const [key, value] of Object.entries(detail || {})) {
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (v !== null && typeof v !== 'object') out[`${key}_${k}`] = v;
      }
    } else if (value !== null && value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

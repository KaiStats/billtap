import { useState } from "react";
import { ENVIRONMENT, IS_PRODUCTION, APP_ID } from "@/lib/environment";

/**
 * A permanent, unmissable marker on anything that is not production.
 *
 * Every configuration guard in this codebase protects against a machine being
 * pointed at the wrong database. None of them protect against a person: the
 * staging site and the live site are the same pixels, so it is entirely
 * possible to spend twenty minutes confirming payments on real restaurants'
 * bills while believing you are testing. A label is the cheapest thing that
 * has ever prevented that, and it costs production nothing — this renders null
 * there, so the bundle carries a few lines and no markup.
 *
 * Tapping it shows which Base44 app is behind the screen, because "am I on the
 * right database" is the actual question and an environment name is only a
 * proxy for it.
 */
export default function EnvironmentBadge() {
  const [expanded, setExpanded] = useState(false);

  if (IS_PRODUCTION) return null;

  const colour = ENVIRONMENT === 'staging'
    ? { bg: 'rgba(245,158,11,0.92)', fg: '#1a1200' }
    : { bg: 'rgba(139,92,246,0.92)', fg: '#ffffff' };

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-label={`${ENVIRONMENT} environment. This is not the live site. Tap for the app id.`}
      style={{
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2147483647,
        maxWidth: '92vw',
        padding: expanded ? '6px 14px' : '3px 12px',
        borderRadius: '0 0 10px 10px',
        border: 'none',
        background: colour.bg,
        color: colour.fg,
        font: '700 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        // Never in the way of the thing being tested.
        pointerEvents: 'auto',
        cursor: 'pointer',
        boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {expanded
        ? `${ENVIRONMENT} · app ${APP_ID || 'NOT SET'}`
        : `${ENVIRONMENT} — not live data`}
    </button>
  );
}

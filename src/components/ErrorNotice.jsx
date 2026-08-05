import React from "react";
import { AlertTriangle, ArrowRight, RefreshCw, X } from "lucide-react";
import { describeError } from "@/lib/errors";

/**
 * A failure, shown in the page instead of in a modal dialog.
 *
 * ── Why not alert() ─────────────────────────────────────────────────────────
 *
 * alert() blocks the page. On a phone, at a table, usually while somebody else
 * is waiting to scan the same receipt. It also cannot be styled, cannot offer a
 * retry, and vanishes the moment it is dismissed — so the request id it would
 * need to carry has nowhere to live.
 *
 * ── What it has to do ───────────────────────────────────────────────────────
 *
 * **Say what happened, not that something happened.** The server sends a
 * sentence written for this failure — the amounts that did not add up, the name
 * of the diner who already paid. That wins over anything generic.
 *
 * **Offer the action that might work.** A retry button only when repeating the
 * request could plausibly succeed. Offering one on a rejected input trains
 * people to press a button that cannot help.
 *
 * **Be reportable.** The request id, small, under the message. It is the only
 * thing that turns "the app said error" into one log query — see
 * worker/lib/errors.js.
 *
 * **Offer the way round, when there is one.** A retry is the right answer to a
 * slow network and the wrong one to a provider that is down: it fails again,
 * more slowly, and the person leaves. `fallback` is for the case where some
 * other path through the product still works — see the scan failure in
 * NewReceipt.jsx, where an even split needs no model at all and was sitting
 * one collapsed panel away, unmentioned, while the diner retried.
 */
/**
 * @param {{ error?: any, onRetry?: any, onDismiss?: any, className?: any,
 *   fallback?: { label: string, onSelect: () => void } | null,
 *   [key: string]: any }} props
 */
export default function ErrorNotice({ error, onRetry, onDismiss, fallback = null, className = "" }) {
  if (!error) return null;
  const { message, advice, requestId, retry } = describeError(error);

  return (
    <div
      // assertive, not polite: this replaced a modal dialog, and a screen reader
      // user who was told nothing would carry on waiting for a result that is
      // never coming.
      role="alert"
      aria-live="assertive"
      className={`rounded-2xl border border-red-200 bg-red-50 p-4 text-left ${className}`}
    >
      <div className="flex gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-red-900">{message}</p>
          {advice && <p className="mt-1 text-sm text-red-800">{advice}</p>}

          <div className="flex flex-wrap items-center gap-2">
            {(retry && onRetry) && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Try again
              </button>
            )}

            {/*
              Shown alongside the retry rather than instead of it. Both can be
              right at once — the network may recover on the next tap, and if it
              does not, this is the path that does not depend on it.
            */}
            {fallback && (
              <button
                type="button"
                onClick={fallback.onSelect}
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-100"
              >
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
                {fallback.label}
              </button>
            )}
          </div>

          {requestId && (
            // Selectable, and labelled in a way somebody can read down a phone.
            // Without this the support conversation has no starting point.
            <p className="mt-3 text-xs text-red-700/80">
              If you report this, quote{" "}
              <code className="select-all rounded bg-red-100 px-1 py-0.5 font-mono">{requestId}</code>
            </p>
          )}
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            // The visible name is an icon, so the accessible name has to come
            // from here — and it has to say what the button does, not what it
            // looks like.
            aria-label="Dismiss this error"
            className="shrink-0 rounded-lg p-1 text-red-600 hover:bg-red-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

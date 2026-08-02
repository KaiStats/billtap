import { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Keeps a split up to date on everyone's phone.
 *
 * This is the moment the product is sold on: five people round a table, and as
 * each one settles up a tick appears on every other screen without anybody
 * refreshing anything.
 *
 * It was not happening. All three screens watched
 * base44.entities.Session.subscribe(), and for a guest that socket connects
 * anonymously — its own URL reads app_id=null&token=null — while Session's read
 * rule matches created_by_id or a participant id belonging to a Base44 user. A
 * guest is neither, so no event was ever going to arrive. Every diner sat
 * looking at whatever the screen said when they loaded it.
 *
 * Polling instead, because it works for a guest, needs no Durable Object and no
 * binding this Cloudflare account may not have, and a split lives about fifteen
 * minutes. The cost of that is requests, so this spends them where they matter:
 *
 *   - Nothing at all while the tab is hidden. Phones spend most of a meal in a
 *     pocket, and the screen is re-read the moment it comes back.
 *   - Fast while things are moving, slow when they are not. Every change resets
 *     to the quick interval; a quiet minute backs off toward the slow one.
 *   - Stops once the split is complete. There is nothing left to watch.
 *   - Backs off on failure rather than hammering a struggling network, and
 *     never surfaces a transient error — a dropped poll is not worth telling a
 *     diner about when the next one is seconds away.
 */

const FAST_MS = 3000;
const SLOW_MS = 15000;
const QUIET_AFTER_MS = 60000;
const MAX_BACKOFF_MS = 30000;

/**
 * @param sessionId    the split to watch
 * @param options.participantId  scopes the read to this diner's own view
 * @param options.hostKey        reads as the host instead, seeing every amount
 * @param options.onUpdate       called with a fresh session, only when it changed
 * @param options.enabled        false to stand down entirely
 */
export function useLiveSplit(sessionId, { participantId, hostKey, onUpdate, enabled = true } = {}) {
  // Held in a ref so a caller can pass an inline function without restarting
  // the poll loop on every render.
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!sessionId || !enabled) return undefined;

    let stopped = false;
    let timer = null;
    let failures = 0;
    let lastChangeAt = Date.now();
    let lastSeen = null;

    /**
     * What counts as news.
     *
     * Comparing whole sessions would fire on every poll, because the server
     * rounds and re-serialises. These are the fields a person at the table can
     * see change: who is here, what they owe, whether they have settled, and
     * whether the split is finished.
     */
    const fingerprint = (session) => JSON.stringify([
      session.status,
      (session.participants || []).map((p) => [
        p.participant_id, p.name, p.payment_status, p.amount_owed ?? null,
      ]),
      (session.items || []).map((i) => [i.id, (i.claimed_by || []).join(",")]),
    ]);

    const nextDelay = () => {
      if (failures > 0) return Math.min(FAST_MS * 2 ** failures, MAX_BACKOFF_MS);
      return Date.now() - lastChangeAt > QUIET_AFTER_MS ? SLOW_MS : FAST_MS;
    };

    const poll = async () => {
      if (stopped) return;
      if (document.visibilityState === "hidden") return schedule();

      try {
        const res = hostKey
          ? await base44.functions.invoke("getSessionAsHost", { session_id: sessionId, host_key: hostKey })
          : await base44.functions.invoke("getSplitStatus", { session_id: sessionId, participant_id: participantId });

        const session = res?.data?.session;
        failures = 0;

        if (session) {
          const print = fingerprint(session);
          if (print !== lastSeen) {
            lastSeen = print;
            lastChangeAt = Date.now();
            onUpdateRef.current?.(session);
          }
          // Nothing further will happen to a finished split.
          if (session.status === "completed") return;
        }
      } catch {
        // A dropped poll is not news. The next one is seconds away, and telling
        // a diner their connection hiccuped mid-meal helps nobody.
        failures += 1;
      }
      schedule();
    };

    function schedule() {
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(poll, nextDelay());
    }

    // Coming back to the tab is the most likely moment for something to have
    // changed, so read immediately rather than waiting out the interval.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped) {
        clearTimeout(timer);
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    poll();

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sessionId, participantId, hostKey, enabled]);
}

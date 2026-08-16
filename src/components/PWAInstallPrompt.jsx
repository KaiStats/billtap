import { useState, useEffect } from "react";
import { X, Download, Share2, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** @param {{ onDismiss?: any, [key: string]: any }} props */
export default function PWAInstallPrompt({ onDismiss }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isIOS, setIsIOS] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const isIOSDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    setIsIOS(isIOSDevice);

    const alreadyInstalled = localStorage.getItem("billtap-installed");
    if (alreadyInstalled) return;

    /**
     * A visit, not a page view.
     *
     * ── What this was doing ────────────────────────────────────────────────
     *
     * The counter incremented on every mount, so it counted taps rather than
     * visits. A guest scanning a table tent and pressing "Start the split" —
     * two pages, about ten seconds apart, on their first ever encounter — hit
     * two and got "Install BillTap" while they were in the middle of splitting
     * a bill with friends.
     *
     * The name says what was meant: ask somebody who came back, not somebody
     * who is mid-meal and has not finished the thing they came to do. Measured
     * against production before changing it — first page hidden, second page
     * shown, on a fresh browser both times.
     *
     * ── Half an hour ───────────────────────────────────────────────────────
     *
     * Longer than any single visit to a restaurant table, shorter than the gap
     * before somebody genuinely comes back. A whole meal, from scanning the
     * tent to the last person paying, stays one visit however many screens it
     * takes — and a diner who opens the app again that evening to check what
     * they owe is a second one, which is exactly when the offer is worth
     * making: they have used it, it worked, and now it is worth a home screen.
     */
    const RETURN_AFTER_MS = 30 * 60 * 1000;
    const now = Date.now();
    const lastVisit = parseInt(localStorage.getItem("billtap-last-visit") || "0", 10);
    const visitCount = parseInt(localStorage.getItem("billtap-visit-count") || "0", 10);

    // A stored timestamp in the future is a clock that moved, not a visit.
    const isNewVisit = !lastVisit || now - lastVisit > RETURN_AFTER_MS || lastVisit > now;
    const newCount = isNewVisit ? visitCount + 1 : visitCount;

    if (isNewVisit) localStorage.setItem("billtap-visit-count", newCount.toString());
    // Written on every mount, so the clock runs from the last thing they did
    // rather than from when the sitting began. Someone who spends forty
    // minutes over dinner is still on their first visit at the end of it.
    localStorage.setItem("billtap-last-visit", now.toString());

    if (newCount < 2) return;

    if (!isIOSDevice) {
      const handleBeforeInstallPrompt = (e) => {
        e.preventDefault();
        setDeferredPrompt(e);
        setTimeout(() => setShowPrompt(true), 1000);
      };

      window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    } else {
      setTimeout(() => setShowPrompt(true), 2000);
    }
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        localStorage.setItem("billtap-installed", "true");
      }
      setDeferredPrompt(null);
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem("billtap-installed", "true");
    setShowPrompt(false);
    onDismiss?.();
  };

  if (!showPrompt) return null;

  if (isIOS) {
    return (
      <div className="fixed bottom-20 left-4 right-4 z-50">
        <Card className="rounded-2xl border-0 shadow-2xl bg-surface-raised">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="font-bold text-foreground text-sm">Install BillTap</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Tap <Share2 className="w-3 h-3 inline mx-1" /> then <strong>"Add to Home Screen"</strong>
                </p>
              </div>
              <button
                onClick={handleDismiss}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-lg p-2">
              <ArrowUp className="w-4 h-4" />
              <span>Share button is at the bottom of Safari</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50">
      <Card className="rounded-2xl border-0 shadow-2xl bg-surface-raised">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="font-bold text-foreground text-sm">Install BillTap</p>
              <p className="text-xs text-muted-foreground mt-1">
                Get the full experience — add to your home screen
              </p>
            </div>
            <button
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <Button
            onClick={handleInstallClick}
            className="w-full bg-brand hover:bg-brand/90 text-brand-foreground font-bold rounded-xl h-10 text-sm"
          >
            <Download className="w-4 h-4 mr-2" />
            Install Now
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
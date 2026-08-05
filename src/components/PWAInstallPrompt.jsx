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

    const visitCount = parseInt(localStorage.getItem("billtap-visit-count") || "0", 10);
    const newCount = visitCount + 1;
    localStorage.setItem("billtap-visit-count", newCount.toString());

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
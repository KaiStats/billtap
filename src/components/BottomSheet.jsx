import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check } from "lucide-react";

/**
 * Mobile-friendly bottom sheet that replaces Radix dropdowns/selects.
 * Usage:
 *   <BottomSheet open={open} onClose={() => setOpen(false)} title="Pick one">
 *     <BottomSheetOption label="Option A" onSelect={() => { setValue("a"); setOpen(false); }} />
 *   </BottomSheet>
 *
 * NOTE: Does NOT call e.preventDefault() on popstate — the TabNavigationProvider
 * owns that event. Instead, closing is triggered by the TabNav's back action externally,
 * or the user dismisses the sheet themselves.
 */
export function BottomSheet({ open, onClose, title, children }) {
  const closeButtonRef = useRef(null);

  // Prevent body scroll while open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Move focus to close button when opened
  useEffect(() => {
    if (open) setTimeout(() => closeButtonRef.current?.focus(), 50);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 z-40"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            key="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title || "Options"}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-surface-raised rounded-t-3xl shadow-2xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1" aria-hidden="true">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              {title
                ? <span className="font-semibold text-foreground text-base">{title}</span>
                : <span />
              }
              <button
                ref={closeButtonRef}
                onClick={onClose}
                aria-label="Close"
                className="w-9 h-9 flex items-center justify-center rounded-full bg-muted active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              </button>
            </div>

            {/* Content */}
            <div className="px-4 py-2 pb-4 max-h-[70vh] overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function BottomSheetOption({ label, description, selected, onSelect, icon: Icon, destructive }) {
  return (
    <button
      onClick={onSelect}
      role="option"
      aria-selected={selected}
      className={`w-full flex items-center gap-3 px-3 py-4 rounded-2xl text-left transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset
        ${selected ? "bg-brand-muted" : ""}
        ${destructive ? "text-destructive" : "text-foreground"}
      `}
    >
      {Icon && (
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0
          ${destructive ? "bg-danger-muted" : selected ? "bg-brand-muted" : "bg-muted"}`}>
          <Icon className={`w-5 h-5 ${destructive ? "text-destructive" : selected ? "text-brand" : "text-muted-foreground"}`} aria-hidden="true" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className={`font-medium text-sm ${destructive ? "text-destructive" : selected ? "text-brand-muted-foreground" : "text-foreground"}`}>
          {label}
        </div>
        {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
      </div>
      {selected && (
        <div className="w-5 h-5 rounded-full bg-brand flex items-center justify-center shrink-0">
          <Check className="w-3 h-3 text-brand-foreground" aria-hidden="true" />
        </div>
      )}
    </button>
  );
}
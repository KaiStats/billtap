import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

/**
 * Mobile-friendly bottom sheet that replaces Radix dropdowns/selects.
 * Usage:
 *   <BottomSheet open={open} onClose={() => setOpen(false)} title="Pick one">
 *     <BottomSheetOption label="Option A" onSelect={() => { setValue("a"); setOpen(false); }} />
 *   </BottomSheet>
 */
export function BottomSheet({ open, onClose, title, children }) {
  // Close on back gesture / browser back
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { e.preventDefault(); onClose(); };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [open, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 z-40"
            onClick={onClose}
          />
          {/* Sheet */}
          <motion.div
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>

            {/* Header */}
            {title && (
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <span className="font-semibold text-gray-900 text-base">{title}</span>
                <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 active:bg-gray-200">
                  <X className="w-4 h-4 text-gray-600" />
                </button>
              </div>
            )}

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
      className={`w-full flex items-center gap-3 px-3 py-4 rounded-2xl text-left transition-colors active:bg-gray-100
        ${selected ? "bg-purple-50" : ""}
        ${destructive ? "text-red-600" : "text-gray-900"}
      `}
    >
      {Icon && (
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0
          ${destructive ? "bg-red-100" : selected ? "bg-purple-100" : "bg-gray-100"}`}>
          <Icon className={`w-5 h-5 ${destructive ? "text-red-600" : selected ? "text-purple-600" : "text-gray-600"}`} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className={`font-medium text-sm ${destructive ? "text-red-600" : selected ? "text-purple-700" : "text-gray-900"}`}>{label}</div>
        {description && <div className="text-xs text-gray-400 mt-0.5">{description}</div>}
      </div>
      {selected && <div className="w-5 h-5 rounded-full bg-purple-600 flex items-center justify-center shrink-0">
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>}
    </button>
  );
}
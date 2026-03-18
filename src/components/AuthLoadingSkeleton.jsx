import { Skeleton } from "@/components/ui/skeleton";

export default function AuthLoadingSkeleton() {
  return (
    <div 
      className="flex flex-col min-h-screen bg-background"
      role="status"
      aria-live="polite"
      aria-label="Authenticating user"
    >
      {/* Header Skeleton */}
      <div className="sticky top-0 z-10 bg-surface-raised border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <Skeleton className="h-8 w-32 rounded" />
        </div>
      </div>

      {/* Main Content Skeleton */}
      <div className="max-w-4xl mx-auto p-5 space-y-5 pb-28 flex-1">
        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl bg-card shadow-sm p-5 flex items-center gap-4">
              <Skeleton className="w-12 h-12 rounded-xl shrink-0" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-7 w-3/4 rounded" />
                <Skeleton className="h-4 w-1/2 rounded" />
              </div>
            </div>
          ))}
        </div>

        {/* Section header */}
        <div className="flex items-center justify-between pt-2">
          <div className="space-y-2">
            <Skeleton className="h-8 w-28 rounded" />
            <Skeleton className="h-4 w-36 rounded" />
          </div>
          <Skeleton className="h-11 w-28 rounded-xl" />
        </div>

        {/* Content rows */}
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl bg-card shadow-sm p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Skeleton className="w-12 h-12 rounded-xl shrink-0" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-40 rounded" />
                  <Skeleton className="h-4 w-28 rounded" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-12 rounded" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Nav Skeleton */}
      <nav 
        className="fixed bottom-0 left-0 right-0 z-50 bg-surface-raised border-t border-border flex items-center justify-around"
        aria-hidden="true"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col items-center justify-center flex-1 py-2 gap-0.5 min-h-[44px]">
            <Skeleton className="w-6 h-6 rounded" />
            <Skeleton className="h-3 w-10 rounded mt-1" />
          </div>
        ))}
      </nav>

      <span className="sr-only">Loading application, please wait...</span>
    </div>
  );
}
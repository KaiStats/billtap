import { Skeleton } from "@/components/ui/skeleton";

export default function ReceiptDetailSkeleton() {
  return (
    <div
      className="max-w-2xl mx-auto p-5 space-y-5"
      style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      aria-busy="true"
      aria-label="Loading receipt"
    >
      {/* Meta row */}
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-48 rounded" />
          <Skeleton className="h-4 w-36 rounded" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full ml-4" />
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between">
          <Skeleton className="h-3 w-20 rounded" />
          <Skeleton className="h-3 w-8 rounded" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </div>

      {/* Image placeholder */}
      <Skeleton className="w-full h-44 rounded-2xl" />

      {/* Items card */}
      <div className="rounded-2xl bg-card shadow-sm p-5 space-y-3">
        <Skeleton className="h-5 w-16 rounded mb-1" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex justify-between items-center">
            <Skeleton className="h-4 w-40 rounded" />
            <Skeleton className="h-4 w-14 rounded" />
          </div>
        ))}
        <div className="pt-2 border-t border-border flex justify-between">
          <Skeleton className="h-5 w-12 rounded" />
          <Skeleton className="h-5 w-16 rounded" />
        </div>
      </div>

      {/* Participants card */}
      <div className="rounded-2xl bg-card shadow-sm p-5 space-y-3">
        <Skeleton className="h-5 w-32 rounded mb-1" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between p-3 bg-surface rounded-xl">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-24 rounded" />
              <Skeleton className="h-6 w-16 rounded" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
import { useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";

/**
 * Listens for globally-broadcast mutation errors and shows a toast.
 * Mount once inside QueryClientProvider.
 */
export default function MutationErrorToast() {
  const { toast } = useToast();

  useEffect(() => {
    const handler = (e) => {
      toast({
        title: "Something went wrong",
        description: e.detail?.message || "Your change couldn't be saved. Please try again.",
        variant: "destructive",
      });
    };
    window.addEventListener("mutation-error", handler);
    return () => window.removeEventListener("mutation-error", handler);
  }, [toast]);

  return null;
}

/** Call this from any mutation's onError to surface the error globally. */
export function dispatchMutationError(error) {
  window.dispatchEvent(new CustomEvent("mutation-error", { detail: { message: error?.message } }));
}
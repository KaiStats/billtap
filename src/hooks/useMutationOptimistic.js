import { useMutation } from '@tanstack/react-query';
import { dispatchMutationError } from '@/components/MutationErrorToast';

/**
 * Custom hook for standardized optimistic UI mutations
 * Follows the pattern: onMutate (optimistic state) → onError (rollback)
 * 
 * @param {Function} mutationFn - Async function that performs the mutation
 * @param {Object} options - Query options
 *   - onOptimisticState: (variables) => snapshot to restore on error
 *   - onRollback: (snapshot) => void to restore state on error
 *   - onSuccess: (data) => void callback after mutation succeeds
 *   - showErrorToast: boolean (default: true) - whether to show error toast
 * 
 * @returns {Object} Mutation object with mutate, isPending, isError
 */
export function useMutationOptimistic(mutationFn, options = {}) {
  const {
    onOptimisticState,
    onRollback,
    onSuccess,
    showErrorToast = true,
  } = options;

  return useMutation({
    mutationFn,
    onMutate: (variables) => {
      // Capture snapshot for rollback
      return onOptimisticState?.(variables);
    },
    onError: (error, variables, snapshot) => {
      // Rollback to previous state
      if (snapshot) {
        onRollback?.(snapshot);
      }
      // Show error toast
      if (showErrorToast) {
        dispatchMutationError(error);
      }
    },
    onSuccess,
  });
}
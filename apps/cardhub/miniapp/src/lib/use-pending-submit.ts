import { useRef, useState } from 'react';

/**
 * Guards a submit handler against double-clicks in the same tick
 * (`useRef`) and against clicks while a request is in flight (`useState`).
 * Matches the CH-301 §5 PrimaryButton / form contract from A.
 */
export function usePendingSubmit() {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const begin = (): boolean => {
    if (pending || pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    return true;
  };

  const end = (): void => {
    pendingRef.current = false;
    setPending(false);
  };

  return { pending, begin, end };
}

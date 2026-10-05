import { useCallback, useEffect, useRef } from "react";

/** Reject a captured UI action after ownership or enabled state changes. */
export function useActionOwnershipFence(owners: readonly unknown[], enabled = true): () => boolean {
  const stable = useRef({ owners, enabled });
  if (stable.current.enabled !== enabled || stable.current.owners.length !== owners.length ||
      owners.some((owner, index) => !Object.is(owner, stable.current.owners[index]))) {
    stable.current = { owners, enabled };
  }
  const captured = stable.current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return useCallback(() => mounted.current && captured.enabled &&
    stable.current === captured, [captured]);
}

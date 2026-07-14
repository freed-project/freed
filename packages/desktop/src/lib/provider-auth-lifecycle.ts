import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  isFactoryResetInProgress,
  trackFactoryResetSensitiveOperation,
} from "@freed/ui/lib/factory-reset";
import {
  assertFactoryResetEpoch,
  runFactoryResetSensitiveDesktopOperation,
} from "./factory-reset-guard";
import { safeUnlisten } from "./safe-unlisten";

type ProviderAuthQuiesceHandler = () => void | Promise<void>;

let acceptingProviderAuthWork = true;
const providerAuthQuiesceHandlers = new Set<ProviderAuthQuiesceHandler>();
const activeProviderAuthControllers = new Set<AbortController>();
const activeProviderAuthRequests = new Set<Promise<unknown>>();

function trackProviderAuthRequest<T>(operation: Promise<T>): Promise<T> {
  const shared = trackFactoryResetSensitiveOperation(operation);
  const tracked = shared.finally(() => {
    activeProviderAuthRequests.delete(tracked);
  });
  activeProviderAuthRequests.add(tracked);
  return tracked;
}

/** True while provider login callbacks may issue work or persist auth state. */
export function isDesktopProviderAuthAllowed(): boolean {
  return acceptingProviderAuthWork && !isFactoryResetInProgress();
}

/** Register a live login flow so factory reset can cancel its timers and polling. */
export function registerDesktopProviderAuthQuiesceHandler(
  handler: ProviderAuthQuiesceHandler,
): () => void {
  if (!isDesktopProviderAuthAllowed()) {
    void trackProviderAuthRequest(Promise.resolve().then(handler)).catch(
      (error) => {
        console.error(
          "[provider-auth] late reset quiesce handler failed",
          error,
        );
      },
    );
    return () => {};
  }
  providerAuthQuiesceHandlers.add(handler);
  return () => providerAuthQuiesceHandlers.delete(handler);
}

/** Track one provider-contacting login request through the shared reset drain. */
export function runDesktopProviderAuthRequest<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!isDesktopProviderAuthAllowed()) {
    return Promise.reject(new Error("Factory reset is in progress"));
  }

  const controller = new AbortController();
  activeProviderAuthControllers.add(controller);
  const request = runFactoryResetSensitiveDesktopOperation(async (epoch) => {
    if (!isDesktopProviderAuthAllowed()) {
      throw new Error("Factory reset is in progress");
    }
    const result = await operation(controller.signal);
    assertFactoryResetEpoch(epoch);
    if (!isDesktopProviderAuthAllowed()) {
      throw new Error("Factory reset is in progress");
    }
    return result;
  });
  const tracked = trackProviderAuthRequest(request).finally(() => {
    activeProviderAuthControllers.delete(controller);
  });
  return tracked;
}

interface DesktopProviderAuthCheckOptions<Payload> {
  eventName: string;
  command: string;
  timeoutMs: number;
  isLoggedIn: (payload: Payload) => boolean;
}

/** Run one native auth check and keep its event listener inside the reset boundary. */
export function requestDesktopProviderAuthCheck<Payload>({
  eventName,
  command,
  timeoutMs,
  isLoggedIn,
}: DesktopProviderAuthCheckOptions<Payload>): Promise<boolean> {
  return runDesktopProviderAuthRequest(async (signal) => {
    let unlisten: UnlistenFn | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let resolveResult: (loggedIn: boolean) => void = () => {};
    const result = new Promise<boolean>((resolve) => {
      resolveResult = resolve;
    });
    const finish = (loggedIn: boolean) => {
      if (settled) return;
      settled = true;
      resolveResult(loggedIn);
    };
    const handleAbort = () => finish(false);
    signal.addEventListener("abort", handleAbort, { once: true });

    try {
      unlisten = await listen<Payload>(eventName, (event) => {
        finish(isLoggedIn(event.payload));
      });
      if (signal.aborted) return false;
      timeout = setTimeout(() => finish(false), timeoutMs);
      void trackProviderAuthRequest(invoke(command)).catch(() => finish(false));
      return await result;
    } catch {
      return false;
    } finally {
      signal.removeEventListener("abort", handleAbort);
      if (timeout !== null) clearTimeout(timeout);
      safeUnlisten(unlisten, `${eventName}:complete`);
    }
  });
}

/** Stop every renderer-owned provider login flow before account cleanup starts. */
export async function quiesceDesktopProviderAuthForFactoryReset(): Promise<void> {
  acceptingProviderAuthWork = false;
  for (const controller of activeProviderAuthControllers) controller.abort();
  const handlerResults = [...providerAuthQuiesceHandlers].map((handler) =>
    Promise.resolve().then(handler),
  );
  providerAuthQuiesceHandlers.clear();
  const [handlerSettlements] = await Promise.all([
    Promise.allSettled(handlerResults),
    Promise.allSettled([...activeProviderAuthRequests]),
  ]);
  const failedHandler = handlerSettlements.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failedHandler) throw failedHandler.reason;
}

/** Reset module state between isolated unit tests. Never call this in product code. */
export function resetDesktopProviderAuthLifecycleForTests(): void {
  acceptingProviderAuthWork = true;
  for (const controller of activeProviderAuthControllers) controller.abort();
  activeProviderAuthControllers.clear();
  activeProviderAuthRequests.clear();
  providerAuthQuiesceHandlers.clear();
}

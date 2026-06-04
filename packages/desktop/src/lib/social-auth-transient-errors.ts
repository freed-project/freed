import { isTransientProviderIssue } from "@freed/ui/lib/provider-status";

export function clearTransientLastCaptureError<
  T extends { lastCaptureError?: string },
>(state: T): T {
  if (!isTransientProviderIssue(state.lastCaptureError)) return state;
  return { ...state, lastCaptureError: undefined };
}

import { log } from "./logger";

type Unlisten = (() => void) | null | undefined;

export function safeUnlisten(unlisten: Unlisten, label: string): void {
  if (!unlisten) return;
  try {
    unlisten();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[event-listener] ignored stale listener cleanup label=${label} error=${message}`);
  }
}

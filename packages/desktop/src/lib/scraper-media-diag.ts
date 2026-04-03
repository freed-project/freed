import { listen } from "@tauri-apps/api/event";
import { addDebugEvent } from "@freed/ui/lib/debug-store";

interface ScraperMediaDiagPayload {
  provider?: string;
  kind?: string;
  reason?: string;
}

export function attachScraperMediaDiagListener(
  platformLabel: string,
  providerToken: string,
  timeoutMs: number = 35_000,
): void {
  listen<ScraperMediaDiagPayload>("freed-scraper-media-diag", (event) => {
    const provider = (event.payload.provider ?? "unknown").toLowerCase();
    if (!provider.includes(providerToken)) return;

    const kind = event.payload.kind ?? "media";
    const reason = event.payload.reason ?? "unknown";
    addDebugEvent(
      "change",
      `[${platformLabel}] silenced ${kind} (${reason}) on ${provider}`,
    );
  }).then((unlisten) => {
    setTimeout(() => void unlisten(), timeoutMs);
  });
}

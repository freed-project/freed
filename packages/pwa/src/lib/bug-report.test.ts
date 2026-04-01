import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import { recordRuntimeError, resetBugReportState } from "@freed/ui/lib/bug-report";
import { pwaBugReporting } from "./bug-report";
import { useAppStore } from "./store";

describe("pwa bug reporting", () => {
  beforeEach(() => {
    resetBugReportState();
    useDebugStore.setState({ events: [], visible: false, docSnapshot: null, cloudProviders: null, perfSnapshot: null, perfResetGeneration: 0 });
    useAppStore.setState({
      items: [],
      feeds: {},
      friends: {},
      totalUnreadCount: 0,
      activeView: "feed",
      isInitialized: true,
      isLoading: false,
      isSyncing: false,
      selectedItemId: null,
      searchQuery: "",
      pendingMatchCount: 0,
      syncConnected: false,
    } as never);
    recordRuntimeError({
      source: "pwa:test",
      fatal: true,
      error: new Error("PWA crash with token=super-secret"),
    });
  });

  it("filters private artifacts out of public-safe bundles", async () => {
    const bundle = await pwaBugReporting.generateBundle({
      privacyTier: "public-safe",
      draft: {
        issueType: "crash",
        title: "PWA crash",
        description: "It crashed",
        reproSteps: "Tap around",
        expectedBehavior: "No crash",
        actualBehavior: "Crash",
        selectedArtifacts: [
          "app-metadata",
          "diagnostic-events",
          "state-summary",
          "crash-context",
          "raw-stack",
          "screenshot",
        ],
        screenshot: {
          name: "capture.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AA==",
          safeForPublic: false,
          capturedAt: Date.now(),
        },
      },
    });

    const zip = await JSZip.loadAsync(bundle.blob);
    expect(bundle.manifest.includedArtifacts).not.toContain("raw-stack");
    expect(bundle.manifest.includedArtifacts).not.toContain("screenshot");
    expect(zip.file("screenshots/capture.png")).toBeNull();
  });
});

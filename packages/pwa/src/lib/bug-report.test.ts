import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import {
  buildPrivateVulnerabilityReportPayload,
  recordRuntimeError,
  resetBugReportState,
} from "@freed/ui/lib/bug-report";
import { pwaBugReporting } from "./bug-report";
import { useAppStore } from "./store";

describe("pwa bug reporting", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
        ],
      },
    });

    const zip = await JSZip.loadAsync(bundle.blob);
    expect(bundle.manifest.includedArtifacts).not.toContain("raw-stack");
    expect(Object.keys(zip.files).some((path) => path.startsWith("screenshots/"))).toBe(false);
  });

  it("pre-populates redacted stack traces for private vulnerability reports", async () => {
    const bundle = await pwaBugReporting.generateBundle({
      privacyTier: "private",
      draft: {
        issueType: "crash",
        title: "Sensitive crash",
        description: "It crashed",
        reproSteps: "Open the reader",
        expectedBehavior: "No crash",
        actualBehavior: "Crash",
        selectedArtifacts: ["app-metadata", "raw-stack"],
      },
    });
    const payload = buildPrivateVulnerabilityReportPayload({
      draft: {
        issueType: "crash",
        title: "Sensitive crash",
        description: "It crashed",
        reproSteps: "Open the reader",
        expectedBehavior: "No crash",
        actualBehavior: "Crash",
        selectedArtifacts: ["app-metadata", "raw-stack"],
      },
      bundle,
    });

    expect(payload.stackTrace).toContain("PWA crash with token=[REDACTED]");
    expect(payload.stackTrace).not.toContain("super-secret");
    expect(payload.appMetadata).toMatchObject({ platform: expect.any(String) });
  });

  it("omits unchecked public-safe artifacts from exported zips", async () => {
    const bundle = await pwaBugReporting.generateBundle({
      privacyTier: "public-safe",
      draft: {
        issueType: "other",
        title: "Minimal report",
        description: "No metadata please.",
        reproSteps: "",
        expectedBehavior: "",
        actualBehavior: "",
        selectedArtifacts: ["crash-context"],
      },
    });

    const zip = await JSZip.loadAsync(bundle.blob);
    const summary = await zip.file("summary.md")?.async("string");

    expect(zip.file("diagnostics/runtime.json")).toBeNull();
    expect(zip.file("diagnostics/state-summary.json")).toBeNull();
    expect(zip.file("diagnostics/report-events.json")).toBeNull();
    expect(zip.file("diagnostics/debug-events.json")).toBeNull();
    expect(summary).not.toContain("Version:");
    expect(summary).not.toContain("Platform:");
  });
});

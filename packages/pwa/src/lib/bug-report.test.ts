import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import { recordRuntimeError, resetBugReportState } from "@freed/ui/lib/bug-report";
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

  it("includes persisted worker debug breadcrumbs in private bundles", async () => {
    window.localStorage.setItem(
      "freed:pwa:automerge-worker-debug:v1",
      JSON.stringify([
        {
          ts: 1_783_000_000_000,
          kind: "merge_ok",
          detail: "[sync-worker] merge: hydrating state access_token=secret-value",
          bytes: 1234,
        },
      ]),
    );

    const bundle = await pwaBugReporting.generateBundle({
      privacyTier: "private",
      draft: {
        issueType: "crash",
        title: "PWA crash",
        description: "It crashed",
        reproSteps: "Connect Google Drive",
        expectedBehavior: "No crash",
        actualBehavior: "Crash",
        selectedArtifacts: ["diagnostic-events"],
      },
    });

    const zip = await JSZip.loadAsync(bundle.blob);
    const workerDebug = await zip.file("diagnostics/worker-debug-events.json")?.async("string");

    expect(workerDebug).toContain("[sync-worker] merge: hydrating state");
    expect(workerDebug).not.toContain("secret-value");
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

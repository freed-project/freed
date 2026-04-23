import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import { clearFatalRuntimeError, recordRuntimeError, resetBugReportState } from "@freed/ui/lib/bug-report";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

import { desktopBugReporting } from "./bug-report";
import { useAppStore } from "./store";

describe("desktop bug reporting", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    resetBugReportState();
    clearFatalRuntimeError();
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
      xAuth: { isAuthenticated: false },
      fbAuth: { isAuthenticated: false },
      igAuth: { isAuthenticated: false },
      liAuth: { isAuthenticated: false },
    } as never);
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "get_platform") return "macos";
      if (command === "get_recent_logs") {
        return [
          "Authorization: Bearer secret-token",
          "/Users/alice/Library/Application Support/Freed/logs/app.log",
        ];
      }
      if (command === "list_snapshots") return ["freed-123.automerge"];
      return null;
    });
    recordRuntimeError({
      source: "desktop:test",
      fatal: true,
      error: new Error("Boom at /Users/alice/Documents/private.txt"),
    });
  });

  it("keeps public-safe bundles free of private artifacts", async () => {
    const bundle = await desktopBugReporting.generateBundle({
      privacyTier: "public-safe",
      draft: {
        issueType: "crash",
        title: "Crash while syncing",
        description: "It exploded.",
        reproSteps: "Open app\nWait",
        expectedBehavior: "No explosion",
        actualBehavior: "Explosion",
        selectedArtifacts: [
          "app-metadata",
          "diagnostic-events",
          "state-summary",
          "crash-context",
          "expanded-logs",
          "snapshot-metadata",
          "raw-stack",
        ],
      },
    });

    const zip = await JSZip.loadAsync(bundle.blob);
    expect(bundle.manifest.privacyTier).toBe("public-safe");
    expect(bundle.manifest.includedArtifacts).not.toContain("expanded-logs");
    expect(bundle.manifest.includedArtifacts).not.toContain("snapshot-metadata");
    expect(bundle.manifest.includedArtifacts).not.toContain("raw-stack");
    expect(zip.file("logs/recent.log")).toBeNull();
    expect(zip.file("diagnostics/snapshots.json")).toBeNull();
  });

  it("omits unchecked public-safe artifacts from the bundle", async () => {
    const bundle = await desktopBugReporting.generateBundle({
      privacyTier: "public-safe",
      draft: {
        issueType: "broken-feature",
        title: "Minimal report",
        description: "Only crash context should ship.",
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

  it("redacts sensitive values even in private bundles", async () => {
    const bundle = await desktopBugReporting.generateBundle({
      privacyTier: "private",
      draft: {
        issueType: "crash",
        title: "Crash while syncing",
        description: "It exploded.",
        reproSteps: "Open app\nWait",
        expectedBehavior: "No explosion",
        actualBehavior: "Explosion",
        selectedArtifacts: [
          "app-metadata",
          "diagnostic-events",
          "state-summary",
          "crash-context",
          "expanded-logs",
          "snapshot-metadata",
          "raw-stack",
        ],
      },
    });

    const zip = await JSZip.loadAsync(bundle.blob);
    const logs = await zip.file("logs/recent.log")?.async("string");
    const fatal = await zip.file("diagnostics/fatal-error.json")?.async("string");

    expect(logs).toContain("Authorization=[REDACTED]");
    expect(logs).toContain("/Users/[REDACTED]");
    expect(fatal).toContain("/Users/[REDACTED]");
    expect(fatal).not.toContain("alice");
  });
});

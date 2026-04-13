import { beforeEach, describe, expect, it, vi } from "vitest";

describe("global bug report capture", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("suppresses benign ResizeObserver window errors while keeping real ones fatal", async () => {
    const bugReport = await import("@freed/ui/lib/bug-report");
    bugReport.resetBugReportState();
    bugReport.installGlobalBugReportCapture("desktop");

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "ResizeObserver loop completed with undelivered notifications.",
      }),
    );

    expect(bugReport.getLastFatalRuntimeError()).toBeNull();
    expect(bugReport.getRecentBugReportEvents()[0]).toMatchObject({
      source: "desktop:window.error",
      level: "warn",
      message: "ResizeObserver loop completed with undelivered notifications.",
    });

    const error = new Error("Boom");
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: error.message,
        error,
      }),
    );

    expect(bugReport.getLastFatalRuntimeError()).toMatchObject({
      source: "desktop:window.error",
      message: "Boom",
      fatal: true,
    });
  });
});

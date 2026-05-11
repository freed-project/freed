/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BugReportBoundary } from "./BugReportBoundary";
import { PlatformProvider, type PlatformConfig } from "../context/PlatformContext";
import { getLastFatalRuntimeError, resetBugReportState } from "../lib/bug-report";

function CrashProbe(): never {
  throw new Error("route render failed");
}

async function renderBoundary(): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const platform = {
    store: (() => undefined) as PlatformConfig["store"],
  } as PlatformConfig;

  await act(async () => {
    root.render(
      <PlatformProvider value={platform}>
        <BugReportBoundary>
          <CrashProbe />
        </BugReportBoundary>
      </PlatformProvider>,
    );
  });

  return { container, root };
}

describe("BugReportBoundary", () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("renders recovery UI instead of a blank shell after a render error", async () => {
    resetBugReportState();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container, root } = await renderBoundary();

    expect(container.textContent).toContain("Freed Desktop hit a fatal error");
    expect(container.textContent).toContain("route render failed");
    expect(getLastFatalRuntimeError()?.message).toBe("route render failed");

    await act(async () => root.unmount());
    container.remove();
    consoleError.mockRestore();
    resetBugReportState();
  });
});

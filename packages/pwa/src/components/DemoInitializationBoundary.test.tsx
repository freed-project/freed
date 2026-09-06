/** @vitest-environment jsdom */
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DemoInitializationBoundary } from "./DemoInitializationBoundary";

it("does not mount route queries until initialization, and leaves ready routes mounted", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const queryLibrary = vi.fn();
  const unmountRoute = vi.fn();
  function LibraryRoute() {
    useEffect(() => {
      queryLibrary();
      return unmountRoute;
    }, []);
    return <span>Map ready</span>;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (pending: boolean) => act(() => root.render(
    <DemoInitializationBoundary pending={pending}>
      <LibraryRoute />
    </DemoInitializationBoundary>,
  ));
  try {
    await render(true);
    await render(true);
    expect(queryLibrary).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await render(false);
    await render(false);
    expect(queryLibrary).toHaveBeenCalledTimes(1);
    expect(unmountRoute).not.toHaveBeenCalled();
    expect(container.textContent).toBe("Map ready");
    expect(container.querySelector('[role="status"]')).toBeNull();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

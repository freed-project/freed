/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  PlatformProvider,
  type PlatformConfig,
} from "../context/PlatformContext";
import { useLegacyLibraryItems } from "./useLegacyLibraryItems";

function Harness({ enabled = true }: { enabled?: boolean }) {
  useLegacyLibraryItems(enabled);
  return null;
}

describe("legacy Library item compatibility lease", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("releases a delayed acquisition when the surface unmounts", async () => {
    let resolveAcquisition: ((release: () => void) => void) | null = null;
    const release = vi.fn();
    const acquireLegacyLibraryItems = vi.fn(
      () =>
        new Promise<() => void>((resolve) => {
          resolveAcquisition = resolve;
        }),
    );
    const platform = {
      store: () => undefined,
      acquireLegacyLibraryItems,
    } as unknown as PlatformConfig;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <Harness />
        </PlatformProvider>,
      );
    });
    expect(acquireLegacyLibraryItems).toHaveBeenCalledOnce();

    await act(async () => root?.unmount());
    root = null;
    await act(async () => resolveAcquisition?.(release));

    expect(release).toHaveBeenCalledOnce();
  });
});

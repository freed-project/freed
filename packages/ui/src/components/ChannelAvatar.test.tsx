/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelAvatar } from "./ChannelAvatar";

async function renderAvatar(element: ReactElement): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return { container, root };
}

describe("ChannelAvatar", () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("renders a single-letter fallback when no URL is available", async () => {
    const { container, root } = await renderAvatar(
      <ChannelAvatar name="Lotus Alchemist" size={28} />,
    );

    expect(container.textContent).toBe("L");
    expect(container.querySelector("img")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("falls back when the image fails and resets for a new URL", async () => {
    const { container, root } = await renderAvatar(
      <ChannelAvatar
        name="Lotus Alchemist"
        avatarUrl="https://example.com/broken.jpg"
        size={28}
      />,
    );

    const image = container.querySelector("img");
    expect(image).toBeInstanceOf(HTMLImageElement);

    await act(async () => {
      image?.dispatchEvent(new Event("error", { bubbles: true }));
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("L");

    await act(async () => {
      root.render(
        <ChannelAvatar
          name="Lotus Alchemist"
          avatarUrl="https://example.com/next.jpg"
          size={28}
        />,
      );
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/next.jpg",
    );

    await act(async () => root.unmount());
    container.remove();
  });
});

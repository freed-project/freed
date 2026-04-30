import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsListPanel } from "@freed/ui/components/settings/SettingsListPanel";

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SettingsListPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("caps the inner scroller and filters with locale formatted counts", async () => {
    const items = Array.from({ length: 1_001 }, (_, index) => ({
      id: `item-${index.toLocaleString()}`,
      label: index === 734 ? "Beta item" : `Alpha ${index.toLocaleString()}`,
    }));

    await act(async () => {
      root.render(
        <SettingsListPanel
          items={items}
          title="Demo"
          searchPlaceholder="Filter demo"
          ariaLabel="Filter demo"
          emptyLabel="No demo items."
          noMatchesLabel="No demo matches."
          dataTestId="demo-list"
          searchDataTestId="demo-filter"
          scrollDataTestId="demo-scroll"
          itemKey={(item) => item.id}
          getSearchText={(item) => item.label}
          renderItem={(item) => <div>{item.label}</div>}
        />,
      );
    });

    expect(container.textContent).toContain("1,001 total");
    const scroll = container.querySelector<HTMLElement>("[data-testid='demo-scroll']");
    expect(scroll?.style.maxHeight).toBe("var(--settings-inner-list-max-height)");

    const input = container.querySelector<HTMLInputElement>("[data-testid='demo-filter']");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      setInputValue(input!, "beta");
    });

    expect(container.textContent).toContain("1 of 1,001");
    expect(container.textContent).toContain("Beta item");
    expect(container.textContent).not.toContain("Alpha 1");
  });

  it("renders empty and no match states", async () => {
    await act(async () => {
      root.render(
        <SettingsListPanel
          items={[]}
          searchPlaceholder="Filter empty"
          ariaLabel="Filter empty"
          emptyLabel="Nothing here."
          noMatchesLabel="No matches here."
          itemKey={(item: { id: string }) => item.id}
          getSearchText={(item) => item.id}
          renderItem={(item) => <div>{item.id}</div>}
        />,
      );
    });

    expect(container.textContent).toContain("Nothing here.");

    await act(async () => {
      root.render(
        <SettingsListPanel
          items={[{ id: "one" }]}
          searchPlaceholder="Filter one"
          ariaLabel="Filter one"
          emptyLabel="Nothing here."
          noMatchesLabel="No matches here."
          searchDataTestId="one-filter"
          itemKey={(item) => item.id}
          getSearchText={(item) => item.id}
          renderItem={(item) => <div>{item.id}</div>}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("[data-testid='one-filter']");
    await act(async () => {
      setInputValue(input!, "missing");
    });

    expect(container.textContent).toContain("No matches here.");
  });
});

describe("settings list scroll enforcement", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const scanRoots = [
    "packages/ui/src/components/settings",
    "packages/desktop/src/components",
    "packages/pwa/src/components",
  ];

  function collectFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const entries = readdirSync(dir);
    return entries.flatMap((entry) => {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) return collectFiles(fullPath);
      return /\.(tsx|ts)$/.test(entry) ? [fullPath] : [];
    });
  }

  it("keeps settings list scrollers behind SettingsListPanel", () => {
    const violations: string[] = [];

    for (const root of scanRoots) {
      for (const file of collectFiles(join(repoRoot, root))) {
        const rel = relative(repoRoot, file);
        if (rel.endsWith("SettingsListPanel.tsx")) continue;
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, index) => {
          if (!line.includes("overflow-y-auto")) return;
          const isOverlay =
            line.includes("theme-elevated-overlay") ||
            line.includes("theme-bg-elevated") ||
            line.includes("max-h-[calc(100dvh-2rem)]");
          if (!isOverlay) {
            violations.push(`${rel}:${(index + 1).toLocaleString()}: ${line.trim()}`);
          }
        });
      }
    }

    expect(violations).toEqual([]);
  });
});

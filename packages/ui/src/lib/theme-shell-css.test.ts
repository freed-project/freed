import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), "../index.css");

function cssBlock(selector: string): string {
  const css = readFileSync(cssPath, "utf8");
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) {
    throw new Error(`Missing CSS block: ${selector}`);
  }
  return match[1];
}

describe("theme shell CSS", () => {
  it("does not keep the whole app shell permanently composited", () => {
    const idleBlock = cssBlock(".theme-shell,\n.app-theme-shell");

    expect(idleBlock).not.toContain("filter:");
    expect(idleBlock).not.toContain("will-change:");
    expect(idleBlock).not.toContain("transition:");
  });

  it("scopes shell filter compositing to active theme transitions", () => {
    const transitionBlock = cssBlock("html[data-theme-transition] .theme-shell,\nhtml[data-theme-transition] .app-theme-shell");

    expect(transitionBlock).toContain("filter:");
    expect(transitionBlock).toContain("opacity: var(--theme-transition-opacity)");
    expect(transitionBlock).toContain("will-change: filter, opacity");
  });
});

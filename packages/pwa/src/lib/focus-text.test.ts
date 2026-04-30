import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyFocusMode, type FocusOptions } from "@freed/shared";
import { FocusText } from "../../../ui/src/components/feed/FocusText.tsx";

function joinedText(options: FocusOptions, text = "Alpha beta gamma"): string {
  return applyFocusMode(text, options).map((segment) => segment.text).join("");
}

function emphasizedText(options: FocusOptions, text = "Alpha beta gamma"): string {
  return applyFocusMode(text, options)
    .filter((segment) => segment.emphasis)
    .map((segment) => segment.text)
    .join("|");
}

describe("applyFocusMode", () => {
  it("returns one un-emphasized segment when disabled", () => {
    expect(applyFocusMode("Alpha beta", { enabled: false, intensity: "strong" })).toEqual([
      { text: "Alpha beta", emphasis: false },
    ]);
  });

  it("keeps the existing intensity ratios", () => {
    expect(emphasizedText({ enabled: true, intensity: "light" })).toBe("Al|b|ga");
    expect(emphasizedText({ enabled: true, intensity: "normal" })).toBe("Al|be|ga");
    expect(emphasizedText({ enabled: true, intensity: "strong" })).toBe("Alp|bet|gam");
  });

  it("preserves whitespace exactly", () => {
    const text = "Alpha   beta\ngamma";

    expect(joinedText({ enabled: true, intensity: "normal" }, text)).toBe(text);
  });

  it("leaves punctuation and numbers un-emphasized", () => {
    const segments = applyFocusMode("Alpha, beta 123", { enabled: true, intensity: "normal" });

    expect(segments).toEqual([
      { text: "Alpha,", emphasis: false },
      { text: " ", emphasis: false },
      { text: "be", emphasis: true },
      { text: "ta", emphasis: false },
      { text: " ", emphasis: false },
      { text: "123", emphasis: false },
    ]);
  });
});

describe("FocusText", () => {
  it("marks emphasized text without semantic or color overrides", () => {
    const html = renderToStaticMarkup(
      createElement(FocusText, {
        text: "Alpha beta",
        options: { enabled: true, intensity: "strong" },
      }),
    );

    expect(html).toContain('data-focus-intensity="strong"');
    expect(html).toContain('class="theme-focus-text__emphasis"');
    expect(html).not.toContain("<strong");
    expect(html).not.toContain("font-bold");
    expect(html).not.toContain("theme-text-primary");
  });
});

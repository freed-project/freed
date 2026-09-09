import { expect, it } from "vitest";
import { lockBodyScroll } from "../../../ui/src/lib/body-scroll-lock";

it("keeps nested overlays locked and restores scrolling when closed out of order", () => {
  document.body.style.overflow = "auto";
  const closeSettings = lockBodyScroll();
  const closeReader = lockBodyScroll();
  closeSettings();
  expect(document.body.style.overflow).toBe("hidden");
  closeSettings();
  expect(document.body.style.overflow).toBe("hidden");
  closeReader();
  expect(document.body.style.overflow).toBe("auto");
  document.body.style.overflow = "";
});

it("restores stylesheet-owned scrolling after repeated overlay cycles", () => {
  document.body.style.overflow = "";
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const closeSheet = lockBodyScroll();
    const closeReader = lockBodyScroll();
    closeReader();
    expect(document.body.style.overflow).toBe("hidden");
    closeSheet();
    expect(document.body.style.overflow).toBe("");
  }
});

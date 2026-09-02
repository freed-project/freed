import { describe, expect, it } from "vitest";
import {
  isFreedDemoHostname,
  isFreedDemoMode,
  isFreedNewsletterPreviewHostname,
} from "./demo-mode";

describe("demo mode", () => {
  it("recognizes only the dedicated production hostname", () => {
    expect(isFreedDemoHostname("demo.freed.wtf")).toBe(true);
    expect(isFreedDemoHostname("DEMO.FREED.WTF")).toBe(true);
    expect(isFreedDemoHostname("app.freed.wtf")).toBe(false);
    expect(isFreedDemoHostname("demo.freed.wtf.example.com")).toBe(false);
  });

  it("allows an explicit demo build for local and release capture", () => {
    expect(isFreedDemoMode("localhost", true)).toBe(true);
    expect(isFreedDemoMode("localhost", false)).toBe(false);
  });

  it("keeps newsletter submissions inert on Vercel preview hosts", () => {
    expect(
      isFreedNewsletterPreviewHostname(
        "freed-pwa-orpin.vercel.app",
      ),
    ).toBe(true);
    expect(isFreedNewsletterPreviewHostname("DEMO.VERCEL.APP")).toBe(true);
    expect(isFreedNewsletterPreviewHostname("demo.freed.wtf")).toBe(false);
    expect(
      isFreedNewsletterPreviewHostname("vercel.app.example.com"),
    ).toBe(false);
  });
});

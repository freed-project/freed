import { describe, expect, it } from "vitest";
import {
  isFreedDemoHostname,
  preserveFreedDemoNavigationUrl,
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

  it("allows explicit demo links only on Vercel preview hosts", () => {
    expect(
      isFreedDemoMode(
        "freed-pwa-git-feat-demo-aubreyfs-projects.vercel.app",
        false,
        "?freed-demo=1",
      ),
    ).toBe(true);
    expect(
      isFreedDemoMode(
        "freed-pwa-git-feat-demo-aubreyfs-projects.vercel.app",
        false,
      ),
    ).toBe(false);
    expect(
      isFreedDemoMode("app.freed.wtf", false, "?freed-demo=1"),
    ).toBe(false);
    expect(
      isFreedDemoMode("vercel.app.example.com", false, "?freed-demo=1"),
    ).toBe(false);
  });

  it("keeps accepted preview demo mode through canonical navigation without granting it to other hosts", () => {
    const entry = "https://freed-preview.vercel.app/?freed-demo=1&theme=ember";
    for (const path of ["/", "/friends", "/?platform=youtube&item=sample"]) {
      const next = new URL(preserveFreedDemoNavigationUrl(path, entry), entry);
      expect(next.searchParams.get("freed-demo")).toBe("1");
      expect(next.searchParams.has("theme")).toBe(false);
      expect(isFreedDemoMode(next.hostname, false, next.search)).toBe(true);
      expect(preserveFreedDemoNavigationUrl(path, "https://app.freed.wtf/?freed-demo=1")).toBe(path);
      expect(preserveFreedDemoNavigationUrl(path, "https://freed-preview.vercel.app/")).toBe(path);
    }
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

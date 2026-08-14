import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";

vi.mock("@tauri-apps/api/path", async () => {
  const actual = await import("../__mocks__/@tauri-apps/api/path");
  return actual;
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

vi.mock("@tauri-apps/plugin-fs", async () => {
  const actual = await import("../__mocks__/@tauri-apps/plugin-fs/index");
  return actual;
});

import {
  __readMemfs,
  __resetMemfs,
  readDir,
} from "../__mocks__/@tauri-apps/plugin-fs/index";
import {
  archiveLibraryCoreProviderMedia,
  archiveMediaVaultCandidate,
  archiveRecentProviderMedia,
  getMediaVaultProviderDir,
  hashMediaBytes,
  readMediaVaultManifest,
  safeMediaVaultFilename,
  setMediaVaultEnabled,
  summarizeMediaVault,
} from "./media-vault";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function ownInstagramItem(mediaUrl: string, id = "post-1"): FeedItem {
  return {
    globalId: `instagram:${id}`,
    platform: "instagram",
    contentType: "post",
    capturedAt: 1_710_000_000_000,
    publishedAt: 1_710_000_000_000,
    author: {
      id: "ada",
      handle: "ada",
      displayName: "Ada",
    },
    content: {
      text: "hello",
      mediaUrls: [mediaUrl],
      mediaTypes: ["image"],
    },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
    sourceUrl: `https://www.instagram.com/p/${id}/`,
  };
}

async function expectNoProviderScanStagingFiles(): Promise<void> {
  await expect(
    readDir("/mock/app-data/media-vault/provider-scan-staging"),
  ).resolves.toEqual([]);
}

describe("media vault", () => {
  beforeEach(() => {
    __resetMemfs();
    vi.restoreAllMocks();
  });

  it("keeps filenames local filesystem safe", () => {
    expect(
      safeMediaVaultFilename(" ../bad:name*with?slashes/and spaces "),
    ).toBe(".._bad_name_with_slashes_and_spaces");
  });

  it("hashes content consistently for dedupe", async () => {
    await expect(hashMediaBytes(bytes("same"))).resolves.toBe(
      await hashMediaBytes(bytes("same")),
    );
    await expect(hashMediaBytes(bytes("same"))).resolves.not.toBe(
      await hashMediaBytes(bytes("different")),
    );
  });

  it("writes media and manifest only to the local vault", async () => {
    await setMediaVaultEnabled("instagram", true);

    const entry = await archiveMediaVaultCandidate({
      provider: "instagram",
      bytes: bytes("image-data"),
      mediaType: "image",
      postId: "post-1",
      mediaUrl: "https://cdn.example.com/one.jpg",
      sourceUrl: "https://www.instagram.com/p/post-1/",
      capturedAt: 1_710_000_000_000,
      importSource: "continuous",
      ownerHandle: "ada",
    });

    expect(entry).not.toBeNull();
    expect(entry?.localPath).toContain("/mock/app-data/media-vault/instagram/");
    expect(__readMemfs(entry?.localPath ?? "")).toEqual(bytes("image-data"));

    const manifest = await readMediaVaultManifest();
    expect(Object.keys(manifest.entries)).toHaveLength(1);
    expect(manifest.providers.instagram.ownerHandles).toEqual(["ada"]);
  });

  it("dedupes by hash and media URL", async () => {
    await setMediaVaultEnabled("facebook", true);

    const first = await archiveMediaVaultCandidate({
      provider: "facebook",
      bytes: bytes("same-file"),
      mediaUrl: "https://cdn.example.com/a.jpg",
      importSource: "continuous",
    });
    const sameHash = await archiveMediaVaultCandidate({
      provider: "facebook",
      bytes: bytes("same-file"),
      mediaUrl: "https://cdn.example.com/b.jpg",
      importSource: "continuous",
    });
    const sameUrl = await archiveMediaVaultCandidate({
      provider: "facebook",
      bytes: bytes("new-file"),
      mediaUrl: "https://cdn.example.com/a.jpg",
      importSource: "continuous",
    });

    expect(sameHash?.id).toBe(first?.id);
    expect(sameUrl?.id).toBe(first?.id);
    expect((await summarizeMediaVault("facebook")).fileCount).toBe(1);
  });

  it("dedupes provider CDN URLs after removing expiring query strings", async () => {
    await setMediaVaultEnabled("instagram", true);

    const first = await archiveMediaVaultCandidate({
      provider: "instagram",
      bytes: bytes("first"),
      mediaUrl: "https://cdn.example.com/photo.jpg?token=one&expires=1",
      importSource: "continuous",
    });
    const second = await archiveMediaVaultCandidate({
      provider: "instagram",
      bytes: bytes("second"),
      mediaUrl: "https://cdn.example.com/photo.jpg?token=two&expires=2",
      importSource: "continuous",
    });

    expect(second?.id).toBe(first?.id);
    expect((await summarizeMediaVault("instagram")).fileCount).toBe(1);
  });

  it("keeps permanent files after the provider archive is disabled", async () => {
    await setMediaVaultEnabled("instagram", true);
    const entry = await archiveMediaVaultCandidate({
      provider: "instagram",
      bytes: bytes("forever"),
      mediaUrl: "https://cdn.example.com/forever.jpg",
      importSource: "continuous",
    });

    await setMediaVaultEnabled("instagram", false);

    expect(__readMemfs(entry?.localPath ?? "")).toEqual(bytes("forever"));
    expect((await summarizeMediaVault("instagram")).fileCount).toBe(1);
  });

  it("records bounded retry state for failed downloads", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("CDN expired"));
    await setMediaVaultEnabled("instagram", true);

    const saved = await archiveMediaVaultCandidate({
      provider: "instagram",
      mediaUrl: "https://cdn.example.com/missing.jpg",
      importSource: "continuous",
    });

    expect(saved).toBeNull();
    const manifest = await readMediaVaultManifest();
    const failure = Object.values(manifest.failures)[0];
    expect(failure?.message).toBe("CDN expired");
    expect(failure?.retryCount).toBe(1);
    expect(failure?.nextRetryAt).toBeGreaterThan(failure?.failedAt ?? 0);
  });

  it("archives recent own-account media after a known handle exists", async () => {
    await setMediaVaultEnabled("instagram", true);
    await archiveMediaVaultCandidate({
      provider: "instagram",
      bytes: bytes("seed"),
      importSource: "meta_export",
      ownerHandle: "ada",
      originalPath: "instagram/posts/seed.jpg",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("recent", { status: 200 }),
    );

    const count = await archiveRecentProviderMedia(
      "instagram",
      [ownInstagramItem("https://cdn.example.com/recent.jpg")],
      "continuous",
    );

    const summary = await summarizeMediaVault("instagram");
    expect(count).toBe(1);
    expect(summary.fileCount).toBe(2);
    expect(summary.byteSize).toBeGreaterThan(0);
  });

  it("does no provider work and removes staging when the source scan fails", async () => {
    await setMediaVaultEnabled("instagram", true);
    await archiveMediaVaultCandidate({
      provider: "instagram",
      bytes: bytes("seed"),
      importSource: "meta_export",
      ownerHandle: "ada",
      originalPath: "instagram/posts/seed.jpg",
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("unexpected", { status: 200 }));

    await expect(
      archiveLibraryCoreProviderMedia(
        "instagram",
        "continuous",
        async (_provider, visitPage) => {
          await visitPage([
            ownInstagramItem("https://cdn.example.com/never-fetch.jpg"),
          ]);
          throw new Error("Library source changed during scan");
        },
      ),
    ).rejects.toThrow("Library source changed during scan");

    expect(fetchSpy).not.toHaveBeenCalled();
    await expectNoProviderScanStagingFiles();
  });

  it("archives staged pages in order only after the source scan completes", async () => {
    await setMediaVaultEnabled("instagram", true);
    await archiveMediaVaultCandidate({
      provider: "instagram",
      bytes: bytes("seed"),
      importSource: "meta_export",
      ownerHandle: "ada",
      originalPath: "instagram/posts/seed.jpg",
    });
    const events: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      events.push(`fetch:${String(input)}`);
      return new Response("media", { status: 200 });
    });

    const count = await archiveLibraryCoreProviderMedia(
      "instagram",
      "continuous",
      async (_provider, visitPage) => {
        events.push("scan:start");
        await visitPage([
          ownInstagramItem("https://cdn.example.com/one.jpg", "post-1"),
        ]);
        events.push("scan:page-1");
        await visitPage([
          ownInstagramItem("https://cdn.example.com/two.jpg", "post-2"),
        ]);
        events.push("scan:complete");
      },
    );

    expect(count).toBe(2);
    expect(events).toEqual([
      "scan:start",
      "scan:page-1",
      "scan:complete",
      "fetch:https://cdn.example.com/one.jpg",
      "fetch:https://cdn.example.com/two.jpg",
    ]);
    await expectNoProviderScanStagingFiles();
  });

  it("rejects malformed provider staging before any provider work", async () => {
    await setMediaVaultEnabled("instagram", true);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("unexpected", { status: 200 }));
    const malformed = {
      ...ownInstagramItem("https://cdn.example.com/never-fetch.jpg"),
      platform: "facebook",
    } as FeedItem;

    await expect(
      archiveLibraryCoreProviderMedia(
        "instagram",
        "continuous",
        async (_provider, visitPage) => {
          await visitPage([malformed]);
        },
      ),
    ).rejects.toThrow("staging item is invalid");

    expect(fetchSpy).not.toHaveBeenCalled();
    await expectNoProviderScanStagingFiles();
  });

  it("creates provider folders before opening them", async () => {
    await expect(getMediaVaultProviderDir("facebook")).resolves.toBe(
      "/mock/app-data/media-vault/facebook",
    );
  });
});

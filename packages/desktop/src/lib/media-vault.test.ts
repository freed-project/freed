import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { __readMemfs, __resetMemfs } from "../__mocks__/@tauri-apps/plugin-fs/index";
import * as fs from "@tauri-apps/plugin-fs";
import {
  archiveMediaVaultCandidate,
  archiveRecentProviderMedia,
  clearMediaVault,
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

function ownInstagramItem(mediaUrl: string): FeedItem {
  return {
    globalId: "instagram:post-1",
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
    sourceUrl: "https://www.instagram.com/p/post-1/",
  };
}

describe("media vault", () => {
  beforeEach(() => {
    __resetMemfs();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps filenames local filesystem safe", () => {
    expect(safeMediaVaultFilename(' ../bad:name*with?slashes/and spaces ')).toBe(
      ".._bad_name_with_slashes_and_spaces",
    );
  });

  it("hashes content consistently for dedupe", async () => {
    await expect(hashMediaBytes(bytes("same"))).resolves.toBe(await hashMediaBytes(bytes("same")));
    await expect(hashMediaBytes(bytes("same"))).resolves.not.toBe(await hashMediaBytes(bytes("different")));
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

  it("creates provider folders before opening them", async () => {
    await expect(getMediaVaultProviderDir("facebook")).resolves.toBe(
      "/mock/app-data/media-vault/facebook",
    );
  });

  it("permanently clears archived files, roster data, failures, and the manifest", async () => {
    await setMediaVaultEnabled("instagram", true);
    const entry = await archiveMediaVaultCandidate({
      provider: "instagram",
      bytes: bytes("private-archive"),
      mediaUrl: "https://cdn.example.com/private.jpg",
      importSource: "meta_export",
      ownerHandle: "ada",
    });
    expect(entry).not.toBeNull();

    await clearMediaVault();

    expect(__readMemfs(entry?.localPath ?? "")).toBeUndefined();
    await expect(summarizeMediaVault("instagram")).resolves.toEqual({
      enabled: false,
      fileCount: 0,
      byteSize: 0,
      failureCount: 0,
      ownerHandles: [],
    });
  });

  it("waits for an in-flight archive before deleting the vault", async () => {
    await setMediaVaultEnabled("instagram", true);
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const originalWriteFile = fs.writeFile;
    const writeFile = vi.spyOn(fs, "writeFile").mockImplementationOnce(
      async (...args: Parameters<typeof fs.writeFile>) => {
        await writeGate;
        await originalWriteFile(...args);
      },
    );

    const archiving = archiveMediaVaultCandidate({
      provider: "instagram",
      bytes: bytes("archive-in-flight"),
      mediaUrl: "https://cdn.example.com/in-flight.jpg",
      importSource: "meta_export",
    });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce());

    const cleared = vi.fn();
    const clearing = clearMediaVault().then(cleared);
    await Promise.resolve();
    expect(cleared).not.toHaveBeenCalled();

    releaseWrite();
    await archiving;
    await clearing;

    expect(await readMediaVaultManifest()).toEqual(
      expect.objectContaining({ entries: {}, failures: {}, roster: {} }),
    );
  });

  it("rejects when the vault directory cannot be removed", async () => {
    await setMediaVaultEnabled("facebook", true);
    const entry = await archiveMediaVaultCandidate({
      provider: "facebook",
      bytes: bytes("must-survive-failed-reset"),
      importSource: "meta_export",
    });
    const error = new Error("media vault is not writable");
    vi.spyOn(fs, "remove").mockRejectedValueOnce(error);

    await expect(clearMediaVault()).rejects.toBe(error);
    expect(__readMemfs(entry?.localPath ?? "")).toEqual(
      bytes("must-survive-failed-reset"),
    );
    await expect(setMediaVaultEnabled("instagram", true)).resolves.toBeUndefined();
  });

  it("times out a stuck media write and releases the reset gate", async () => {
    vi.useFakeTimers();
    await setMediaVaultEnabled("instagram", true);
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const originalWriteFile = fs.writeFile;
    const writeFile = vi.spyOn(fs, "writeFile").mockImplementationOnce(
      async (...args: Parameters<typeof fs.writeFile>) => {
        await writeGate;
        await originalWriteFile(...args);
      },
    );

    const archiving = archiveMediaVaultCandidate({
      provider: "instagram",
      bytes: bytes("stuck-write"),
      importSource: "meta_export",
    });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    const clearing = clearMediaVault();
    const rejection = expect(clearing).rejects.toThrow(
      "Media vault operations did not stop within 180,000 ms.",
    );
    await vi.advanceTimersByTimeAsync(180_000);
    await rejection;

    releaseWrite();
    await archiving;
    await expect(setMediaVaultEnabled("facebook", true)).resolves.toBeUndefined();
  });
});

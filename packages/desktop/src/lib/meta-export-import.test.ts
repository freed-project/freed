import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { __resetMemfs } from "../__mocks__/@tauri-apps/plugin-fs/index";
import { readMediaVaultManifest, summarizeMediaVault } from "./media-vault";
import { importMetaExportFiles } from "./meta-export-import";

async function zipFile(name: string, build: (zip: JSZip) => void): Promise<File> {
  const zip = new JSZip();
  build(zip);
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], name, { type: "application/zip" });
}

describe("Meta export import", () => {
  beforeEach(() => {
    __resetMemfs();
  });

  it("imports Instagram media from a defensive JSON export shape", async () => {
    const file = await zipFile("instagram.zip", (zip) => {
      zip.file("personal_information/profile_information.json", JSON.stringify({ username: "ada.dev" }));
      zip.file("media/posts/2024/photo.jpg", new Uint8Array([1, 2, 3, 4]));
      zip.file("media/reels/reel.mp4", new Uint8Array([5, 6, 7, 8]));
      zip.file("__MACOSX/media/posts/ignored.jpg", new Uint8Array([9]));
      zip.file("messages/inbox/chat/photo.jpg", new Uint8Array([10]));
    });

    const summary = await importMetaExportFiles("instagram", [file]);

    expect(summary.filesScanned).toBe(1);
    expect(summary.mediaFilesFound).toBe(2);
    expect(summary.imported).toBe(2);
    expect(summary.ownerHandles).toEqual(["ada.dev"]);

    const manifest = await readMediaVaultManifest();
    expect(manifest.providers.instagram.ownerHandles).toEqual(["ada.dev"]);
    expect(Object.values(manifest.entries).map((entry) => entry.importSource)).toEqual([
      "meta_export",
      "meta_export",
    ]);
  });

  it("imports Facebook media and skips non-zip files", async () => {
    const file = await zipFile("facebook.zip", (zip) => {
      zip.file("profile_information/profile_information.json", JSON.stringify({ profile_uri: "https://www.facebook.com/ada.lovelace" }));
      zip.file("posts/media/photo.png", new Uint8Array([1, 2, 3]));
      zip.file("your_videos/video.mov", new Uint8Array([4, 5, 6]));
      zip.file("ads_and_businesses/logo.png", new Uint8Array([7, 8]));
    });
    const notZip = new File(["nope"], "notes.txt", { type: "text/plain" });

    const summary = await importMetaExportFiles("facebook", [notZip, file]);

    expect(summary.filesScanned).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.mediaFilesFound).toBe(2);
    expect(summary.imported).toBe(2);
    expect(summary.ownerHandles).toEqual(["ada.lovelace"]);
    expect((await summarizeMediaVault("facebook")).fileCount).toBe(2);
  });
});

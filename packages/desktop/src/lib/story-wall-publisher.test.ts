import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryWallManifest } from "@freed/shared";

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
import { archiveMediaVaultCandidate } from "./media-vault";
import { buildStoryWallStaticFiles, publishStoryWallToGitHubPages } from "./story-wall-publisher";

const manifest: StoryWallManifest = {
  version: 1,
  generatedAt: 1,
  layoutPreset: "mosaic",
  style: {
    palette: "paper",
    typographyScale: 1,
    mediaDensity: 0.7,
    captionsEnabled: true,
    locationGroupingEnabled: true,
    dateGroupingEnabled: true,
    motionLevel: "light",
  },
  embedModeEnabled: true,
  years: [],
  totalItems: 0,
  totalMedia: 0,
};

describe("story wall publisher", () => {
  beforeEach(() => {
    __resetMemfs();
    vi.restoreAllMocks();
  });

  it("generates static site files and vault assets", async () => {
    await archiveMediaVaultCandidate({
      provider: "instagram",
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "image",
      importSource: "meta_export",
      originalPath: "media/stories/one.jpg",
    });

    const files = await buildStoryWallStaticFiles(manifest, "docs");

    expect(files.map((file) => file.path)).toContain("docs/index.html");
    expect(files.map((file) => file.path)).toContain("docs/embed.js");
    expect(files.map((file) => file.path)).toContain("docs/data/story-wall.json");
    expect(files.some((file) => file.path.startsWith("docs/assets/vault/instagram/"))).toBe(true);
  });

  it("publishes through blobs, trees, commits, refs, and Pages setup", async () => {
    const calls: Array<{ path: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init?.method ?? "GET";
      calls.push({ path, method });
      if (path === "/user") return json({ login: "ada" });
      if (path === "/repos/ada/freed-story-wall" && method === "GET") return json({ full_name: "ada/freed-story-wall" });
      if (path === "/repos/ada/freed-story-wall/git/ref/heads/main") return json({ object: { sha: "base" } });
      if (path === "/repos/ada/freed-story-wall/git/commits/base") return json({ tree: { sha: "base-tree" } });
      if (path === "/repos/ada/freed-story-wall/git/blobs") return json({ sha: `blob-${calls.length.toLocaleString()}` });
      if (path === "/repos/ada/freed-story-wall/git/trees") return json({ sha: "new-tree" });
      if (path === "/repos/ada/freed-story-wall/git/commits") return json({ sha: "new-commit" });
      if (path === "/repos/ada/freed-story-wall/git/refs/heads/main") return json({ object: { sha: "new-commit" } });
      if (path === "/repos/ada/freed-story-wall/pages" && method === "GET") return new Response("missing", { status: 404 });
      if (path === "/repos/ada/freed-story-wall/pages" && method === "POST") return json({});
      return new Response("missing", { status: 404 });
    }));

    const result = await publishStoryWallToGitHubPages({
      token: "token",
      repoName: "freed-story-wall",
      branch: "main",
      directory: "docs",
      manifest,
    });

    expect(result).toEqual({
      pagesUrl: "https://ada.github.io/freed-story-wall/",
      commitSha: "new-commit",
      repoFullName: "ada/freed-story-wall",
    });
    expect(calls.some((call) => call.path.endsWith("/git/trees") && call.method === "POST")).toBe(true);
    expect(calls.some((call) => call.path.endsWith("/pages") && call.method === "POST")).toBe(true);
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

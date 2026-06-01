import { readFile } from "@tauri-apps/plugin-fs";
import type { StoryWallManifest } from "@freed/shared";
import { readMediaVaultManifest, type MediaVaultEntry } from "./media-vault";

export interface StoryWallPublishInput {
  token: string;
  owner?: string;
  repoName: string;
  branch: string;
  directory: string;
  manifest: StoryWallManifest;
}

export interface StoryWallPublishOutput {
  pagesUrl: string;
  commitSha: string;
  repoFullName: string;
}

interface GitHubUser {
  login: string;
}

interface GitHubRepo {
  full_name: string;
}

interface GitHubRef {
  object: { sha: string };
}

interface GitHubCommit {
  tree: { sha: string };
}

interface GitHubBlob {
  sha: string;
}

interface GitHubTree {
  sha: string;
}

interface GitHubCreatedCommit {
  sha: string;
}

interface StaticFile {
  path: string;
  bytes: Uint8Array;
}

const API_BASE = "https://api.github.com";
const PAGES_SOFT_LIMIT_BYTES = 1_000_000_000;

function normalizeDirectory(directory: string): string {
  const clean = directory.trim().replace(/^\/+|\/+$/g, "");
  return clean || "docs";
}

function safeRepoName(repoName: string): string {
  return repoName.trim().replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-") || "freed-story-wall";
}

function textFile(path: string, text: string): StaticFile {
  return { path, bytes: new TextEncoder().encode(text) };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function mediaExtension(entry: MediaVaultEntry): string {
  const source = entry.originalPath ?? entry.mediaUrl ?? entry.sourceUrl ?? "";
  const match = source.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i);
  if (match?.[1]) return match[1].toLowerCase();
  if (entry.mediaType === "video") return "mp4";
  if (entry.mediaType === "image") return "jpg";
  return "bin";
}

function vaultAssetPath(directory: string, entry: MediaVaultEntry): string {
  return `${directory}/assets/vault/${entry.provider}/${entry.contentHash.slice(0, 16)}.${mediaExtension(entry)}`;
}

function staticIndexHtml(manifest: StoryWallManifest): string {
  const title = "Freed Story Wall";
  const firstYear = manifest.years[0]?.year;
  const heading = firstYear ? `${firstYear.toLocaleString(undefined, { useGrouping: false })} memories` : "Story Wall";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: ui-serif, Georgia, serif; background: #f7f3ec; color: #1e1b18; }
    header { max-width: 1120px; margin: 0 auto; padding: 48px 20px 24px; }
    h1 { margin: 0; font-size: clamp(34px, 7vw, 84px); line-height: 0.96; letter-spacing: 0; }
    p { color: #6f6760; font-size: 17px; line-height: 1.6; }
    main { max-width: 1120px; margin: 0 auto; padding: 0 20px 56px; }
    .year { margin-top: 32px; }
    .year h2 { font-size: 22px; margin: 0 0 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
    article { background: #fffaf3; border: 1px solid #ddd2c4; border-radius: 8px; overflow: hidden; }
    img, video { display: block; width: 100%; aspect-ratio: 4 / 5; object-fit: cover; background: #e8dfd3; }
    .body { padding: 12px; }
    .meta { font-size: 12px; color: #4f7a69; text-transform: uppercase; letter-spacing: 0.08em; }
    .caption { margin-top: 7px; font-size: 14px; line-height: 1.45; color: #1e1b18; }
  </style>
</head>
<body>
  <header>
    <h1>${heading}</h1>
    <p>Published from a user-owned Freed Story Wall.</p>
  </header>
  <main id="freed-story-wall"></main>
  <script src="./embed.js"></script>
</body>
</html>`;
}

function staticEmbedJs(): string {
  return `async function renderFreedStoryWall(root) {
  const response = await fetch(new URL("./data/story-wall.json", import.meta.url));
  const wall = await response.json();
  root.textContent = "";
  for (const year of wall.years) {
    const section = document.createElement("section");
    section.className = "year";
    const heading = document.createElement("h2");
    heading.textContent = String(year.year);
    const grid = document.createElement("div");
    grid.className = "grid";
    for (const item of year.items) {
      const media = item.media[0];
      const source = media && (media.publishedPath || media.sourceUrl);
      const article = document.createElement("article");
      if (source) {
        if (media.mediaType === "video") {
          const video = document.createElement("video");
          video.controls = true;
          video.src = source;
          article.append(video);
        } else {
          const image = document.createElement("img");
          image.src = source;
          image.alt = "";
          article.append(image);
        }
      }
      const body = document.createElement("div");
      body.className = "body";
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = item.platformLabel;
      body.append(meta);
      if (item.text) {
        const caption = document.createElement("div");
        caption.className = "caption";
        caption.textContent = item.text;
        body.append(caption);
      }
      article.append(body);
      grid.append(article);
    }
    section.append(heading, grid);
    root.append(section);
  }
}
renderFreedStoryWall(document.getElementById("freed-story-wall"));`;
}

async function mediaFilesForVault(directory: string, entries: MediaVaultEntry[]): Promise<StaticFile[]> {
  const files: StaticFile[] = [];
  const totalBytes = entries.reduce((sum, entry) => sum + entry.byteSize, 0);
  if (totalBytes > PAGES_SOFT_LIMIT_BYTES) {
    throw new Error("The local media vault is larger than the GitHub Pages 1 GB soft limit.");
  }
  for (const entry of entries) {
    files.push({ path: vaultAssetPath(directory, entry), bytes: await readFile(entry.localPath) });
  }
  return files;
}

function manifestWithVaultAssets(
  manifest: StoryWallManifest,
  directory: string,
  entries: MediaVaultEntry[],
): StoryWallManifest {
  const entriesByPostId = new Map<string, MediaVaultEntry[]>();
  for (const entry of entries) {
    if (!entry.postId) continue;
    entriesByPostId.set(entry.postId, [...(entriesByPostId.get(entry.postId) ?? []), entry]);
  }
  return {
    ...manifest,
    years: manifest.years.map((year) => ({
      ...year,
      items: year.items.map((item) => {
        const matches = entriesByPostId.get(item.id);
        if (!matches?.length) return item;
        return {
          ...item,
          media: matches.map((entry, index) => ({
            id: `${item.id}:vault:${index}`,
            itemId: item.id,
            provider: entry.provider,
            mediaType: entry.mediaType ?? "unknown",
            sourceUrl: entry.mediaUrl,
            publishedPath: `./${vaultAssetPath(directory, entry).replace(`${directory}/`, "")}`,
            byteSize: entry.byteSize,
            capturedAt: entry.capturedAt,
          })),
        };
      }),
    })),
  };
}

export async function buildStoryWallStaticFiles(
  manifest: StoryWallManifest,
  directoryInput = "docs",
): Promise<StaticFile[]> {
  const directory = normalizeDirectory(directoryInput);
  const vaultManifest = await readMediaVaultManifest();
  const vaultEntries = Object.values(vaultManifest.entries);
  const mediaFiles = await mediaFilesForVault(directory, vaultEntries);
  const publishManifest = manifestWithVaultAssets(manifest, directory, vaultEntries);
  return [
    textFile(`${directory}/.nojekyll`, ""),
    textFile(`${directory}/index.html`, staticIndexHtml(publishManifest)),
    textFile(`${directory}/embed.js`, staticEmbedJs()),
    textFile(`${directory}/data/story-wall.json`, JSON.stringify(publishManifest, null, 2)),
    ...mediaFiles,
  ];
}

async function githubRequest<T>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`GitHub ${response.status.toLocaleString()}: ${message || response.statusText}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function githubRequestMaybe<T>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`GitHub ${response.status.toLocaleString()}: ${message || response.statusText}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function ensureRepo(token: string, owner: string, repoName: string): Promise<GitHubRepo> {
  const existing = await githubRequestMaybe<GitHubRepo>(token, `/repos/${owner}/${repoName}`);
  if (existing) return existing;
  return githubRequest<GitHubRepo>(token, "/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: repoName,
      private: false,
      auto_init: true,
      description: "Freed Story Wall",
    }),
  });
}

async function ensurePages(token: string, owner: string, repoName: string, branch: string, directory: string): Promise<void> {
  const source = { branch, path: `/${directory}` };
  const existing = await githubRequestMaybe<unknown>(token, `/repos/${owner}/${repoName}/pages`);
  if (existing) {
    await githubRequest<unknown>(token, `/repos/${owner}/${repoName}/pages`, {
      method: "PUT",
      body: JSON.stringify({ source }),
    });
    return;
  }
  await githubRequest<unknown>(token, `/repos/${owner}/${repoName}/pages`, {
    method: "POST",
    body: JSON.stringify({ source }),
  });
}

export async function publishStoryWallToGitHubPages(
  input: StoryWallPublishInput,
): Promise<StoryWallPublishOutput> {
  const repoName = safeRepoName(input.repoName);
  const branch = input.branch.trim() || "main";
  const directory = normalizeDirectory(input.directory);
  const user = await githubRequest<GitHubUser>(input.token, "/user");
  const owner = input.owner?.trim() || user.login;
  const repo = await ensureRepo(input.token, owner, repoName);
  const files = await buildStoryWallStaticFiles(input.manifest, directory);
  const ref = await githubRequest<GitHubRef>(input.token, `/repos/${owner}/${repoName}/git/ref/heads/${branch}`);
  const baseCommit = await githubRequest<GitHubCommit>(input.token, `/repos/${owner}/${repoName}/git/commits/${ref.object.sha}`);
  const treeItems = [];

  for (const file of files) {
    const blob = await githubRequest<GitHubBlob>(input.token, `/repos/${owner}/${repoName}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({
        content: bytesToBase64(file.bytes),
        encoding: "base64",
      }),
    });
    treeItems.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const tree = await githubRequest<GitHubTree>(input.token, `/repos/${owner}/${repoName}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseCommit.tree.sha,
      tree: treeItems,
    }),
  });
  const commit = await githubRequest<GitHubCreatedCommit>(input.token, `/repos/${owner}/${repoName}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: "Publish story wall",
      tree: tree.sha,
      parents: [ref.object.sha],
    }),
  });
  await githubRequest<GitHubRef>(input.token, `/repos/${owner}/${repoName}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });
  await ensurePages(input.token, owner, repoName, branch, directory);

  return {
    pagesUrl: `https://${owner}.github.io/${repoName}/`,
    commitSha: commit.sha,
    repoFullName: repo.full_name,
  };
}

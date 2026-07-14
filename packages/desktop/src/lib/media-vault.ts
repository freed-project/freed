import { invoke, isTauri } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readTextFile,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { FeedItem } from "@freed/shared";

export type MediaVaultProvider = "facebook" | "instagram";
export type MediaVaultImportSource = "meta_export" | "profile_backfill" | "continuous";

export interface MediaVaultEntry {
  id: string;
  provider: MediaVaultProvider;
  sourceUrl?: string;
  postId?: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "unknown";
  localPath: string;
  byteSize: number;
  contentHash: string;
  capturedAt: number;
  importSource: MediaVaultImportSource;
  originalPath?: string;
}

export interface MediaVaultFailure {
  id: string;
  provider: MediaVaultProvider;
  mediaUrl?: string;
  sourceUrl?: string;
  postId?: string;
  message: string;
  failedAt: number;
  retryCount: number;
  nextRetryAt?: number;
}

export interface MediaVaultProviderState {
  enabled: boolean;
  lastSuccessAt?: number;
  lastError?: string;
  ownerHandles: string[];
}

export interface MediaVaultRosterEntry {
  id: string;
  provider: MediaVaultProvider;
  externalId?: string;
  handle?: string;
  displayName?: string;
  profileUrl?: string;
  groupId?: string;
  groupName?: string;
  groupUrl?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  source: "captured_item" | "facebook_group" | "meta_export" | "profile_backfill";
}

export interface MediaVaultManifest {
  version: 1;
  providers: Record<MediaVaultProvider, MediaVaultProviderState>;
  entries: Record<string, MediaVaultEntry>;
  failures: Record<string, MediaVaultFailure>;
  roster: Record<string, MediaVaultRosterEntry>;
}

export interface MediaVaultSummary {
  enabled: boolean;
  fileCount: number;
  byteSize: number;
  lastSuccessAt?: number;
  lastError?: string;
  failureCount: number;
  ownerHandles: string[];
}

export interface MediaVaultCandidate {
  provider: MediaVaultProvider;
  bytes?: Uint8Array;
  sourceUrl?: string;
  postId?: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "unknown";
  capturedAt?: number;
  importSource: MediaVaultImportSource;
  originalPath?: string;
  ownerHandle?: string;
}

const MANIFEST_FILE = "manifest.json";
const MANIFEST_VERSION = 1;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const PROVIDERS: MediaVaultProvider[] = ["facebook", "instagram"];

let rootDirCache: string | null = null;
const listeners = new Set<() => void>();

function defaultProviderState(): MediaVaultProviderState {
  return {
    enabled: false,
    ownerHandles: [],
  };
}

function createEmptyManifest(): MediaVaultManifest {
  return {
    version: MANIFEST_VERSION,
    providers: {
      facebook: defaultProviderState(),
      instagram: defaultProviderState(),
    },
    entries: {},
    failures: {},
    roster: {},
  };
}

function normalizeManifest(input: Partial<MediaVaultManifest> | null | undefined): MediaVaultManifest {
  const manifest = createEmptyManifest();
  if (!input) return manifest;

  manifest.entries = input.entries ?? {};
  manifest.failures = input.failures ?? {};
  manifest.roster = input.roster ?? {};
  for (const provider of PROVIDERS) {
    const current = input.providers?.[provider];
    manifest.providers[provider] = {
      enabled: current?.enabled === true,
      lastSuccessAt: current?.lastSuccessAt,
      lastError: current?.lastError,
      ownerHandles: Array.from(new Set(current?.ownerHandles ?? [])),
    };
  }
  return manifest;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function joinPath(base: string, ...parts: string[]): string {
  const cleaned = [base, ...parts].map((part, index) => {
    const trimmed = part.trim();
    return index === 0 ? trimmed.replace(/\/+$/, "") : trimmed.replace(/^\/+|\/+$/g, "");
  });
  return cleaned.filter(Boolean).join("/");
}

async function getMediaVaultRootDir(): Promise<string> {
  if (rootDirCache) return rootDirCache;
  const dataDir = await appDataDir();
  rootDirCache = joinPath(dataDir, "media-vault");
  await mkdir(rootDirCache, { recursive: true });
  return rootDirCache;
}

async function getManifestPath(): Promise<string> {
  return joinPath(await getMediaVaultRootDir(), MANIFEST_FILE);
}

async function ensureProviderDir(provider: MediaVaultProvider): Promise<string> {
  const dir = joinPath(await getMediaVaultRootDir(), provider);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function getMediaVaultProviderDir(provider: MediaVaultProvider): Promise<string> {
  return ensureProviderDir(provider);
}

export function safeMediaVaultFilename(input: string): string {
  const cleaned = input
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (cleaned || "media").slice(0, 96);
}

function extensionFromCandidate(candidate: MediaVaultCandidate): string {
  const source = candidate.originalPath ?? candidate.mediaUrl ?? candidate.sourceUrl ?? "";
  try {
    const parsed = source.startsWith("http") ? new URL(source).pathname : source;
    const match = parsed.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i);
    if (match?.[1]) return match[1].toLowerCase();
  } catch {
    // fall through to media type fallback
  }
  if (candidate.mediaType === "video") return "mp4";
  if (candidate.mediaType === "image") return "jpg";
  return "bin";
}

function fallbackHash(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${String(bytes.length)}`;
}

export async function hashMediaBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fallbackHash(bytes);
  const digestBytes = new Uint8Array(bytes.byteLength);
  digestBytes.set(bytes);
  const digest = await subtle.digest("SHA-256", digestBytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readMediaVaultManifest(): Promise<MediaVaultManifest> {
  const path = await getManifestPath();
  if (!(await exists(path))) return createEmptyManifest();
  try {
    const raw = await readTextFile(path);
    return normalizeManifest(JSON.parse(raw) as Partial<MediaVaultManifest>);
  } catch {
    return createEmptyManifest();
  }
}

async function writeManifest(manifest: MediaVaultManifest): Promise<void> {
  const path = await getManifestPath();
  await writeTextFile(path, JSON.stringify(normalizeManifest(manifest), null, 2));
  notify();
}

function entryKeyForCandidate(candidate: MediaVaultCandidate, contentHash: string): string {
  const key = [
    candidate.provider,
    candidate.postId ?? "",
    normalizeMediaUrl(candidate.mediaUrl) ?? candidate.mediaUrl ?? "",
    candidate.sourceUrl ?? "",
    contentHash,
  ].join("|");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return `${candidate.provider}:${Math.abs(hash).toString(36)}`;
}

function normalizeMediaUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function duplicateEntry(
  manifest: MediaVaultManifest,
  candidate: MediaVaultCandidate,
  contentHash: string,
): MediaVaultEntry | null {
  const normalizedCandidateUrl = normalizeMediaUrl(candidate.mediaUrl);
  for (const entry of Object.values(manifest.entries)) {
    if (entry.provider !== candidate.provider) continue;
    if (entry.contentHash === contentHash) return entry;
    if (candidate.mediaUrl && entry.mediaUrl === candidate.mediaUrl) return entry;
    if (normalizedCandidateUrl && normalizeMediaUrl(entry.mediaUrl) === normalizedCandidateUrl) return entry;
    if (candidate.postId && entry.postId === candidate.postId && candidate.sourceUrl === entry.sourceUrl) {
      return entry;
    }
  }
  return null;
}

function failureKey(candidate: Pick<MediaVaultCandidate, "provider" | "mediaUrl" | "sourceUrl" | "postId">): string {
  return `${candidate.provider}:${candidate.postId ?? ""}:${candidate.mediaUrl ?? candidate.sourceUrl ?? ""}`;
}

async function fetchMediaBytes(url: string): Promise<Uint8Array> {
  if (isTauri()) {
    const data = await invoke<number[]>("fetch_binary_url", { url });
    return new Uint8Array(data);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status.toLocaleString()}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function setMediaVaultEnabled(
  provider: MediaVaultProvider,
  enabled: boolean,
): Promise<void> {
  const manifest = await readMediaVaultManifest();
  manifest.providers[provider].enabled = enabled;
  if (!enabled) {
    manifest.providers[provider].lastError = undefined;
  }
  await writeManifest(manifest);
}

export async function addMediaVaultOwnerHandle(
  provider: MediaVaultProvider,
  handle: string | undefined,
): Promise<void> {
  const cleanHandle = handle?.replace(/^@/, "").trim();
  if (!cleanHandle) return;
  const manifest = await readMediaVaultManifest();
  const handles = new Set(manifest.providers[provider].ownerHandles);
  handles.add(cleanHandle);
  manifest.providers[provider].ownerHandles = Array.from(handles).sort((a, b) => a.localeCompare(b));
  await writeManifest(manifest);
}

export async function archiveMediaVaultCandidate(candidate: MediaVaultCandidate): Promise<MediaVaultEntry | null> {
  const manifest = await readMediaVaultManifest();
  if (!manifest.providers[candidate.provider].enabled && candidate.importSource !== "meta_export") {
    return null;
  }

  try {
    const bytes = candidate.bytes ?? (
      candidate.mediaUrl ? await fetchMediaBytes(candidate.mediaUrl) : null
    );
    if (!bytes) return null;

    const contentHash = await hashMediaBytes(bytes);
    const duplicate = duplicateEntry(manifest, candidate, contentHash);
    if (duplicate) {
      manifest.providers[candidate.provider].lastSuccessAt = Date.now();
      manifest.providers[candidate.provider].lastError = undefined;
      delete manifest.failures[failureKey(candidate)];
      if (candidate.ownerHandle) {
        const handles = new Set(manifest.providers[candidate.provider].ownerHandles);
        handles.add(candidate.ownerHandle);
        manifest.providers[candidate.provider].ownerHandles = Array.from(handles).sort((a, b) => a.localeCompare(b));
      }
      await writeManifest(manifest);
      return duplicate;
    }

    const id = entryKeyForCandidate(candidate, contentHash);
    const ext = extensionFromCandidate(candidate);
    const fileName = `${safeMediaVaultFilename(id)}.${ext}`;
    const providerDir = await ensureProviderDir(candidate.provider);
    const localPath = joinPath(providerDir, fileName);
    await writeFile(localPath, bytes);

    const entry: MediaVaultEntry = {
      id,
      provider: candidate.provider,
      sourceUrl: candidate.sourceUrl,
      postId: candidate.postId,
      mediaUrl: candidate.mediaUrl,
      mediaType: candidate.mediaType ?? "unknown",
      localPath,
      byteSize: bytes.byteLength,
      contentHash,
      capturedAt: candidate.capturedAt ?? Date.now(),
      importSource: candidate.importSource,
      originalPath: candidate.originalPath,
    };
    manifest.entries[id] = entry;
    manifest.providers[candidate.provider].lastSuccessAt = Date.now();
    manifest.providers[candidate.provider].lastError = undefined;
    delete manifest.failures[failureKey(candidate)];
    if (candidate.ownerHandle) {
      const handles = new Set(manifest.providers[candidate.provider].ownerHandles);
      handles.add(candidate.ownerHandle);
      manifest.providers[candidate.provider].ownerHandles = Array.from(handles).sort((a, b) => a.localeCompare(b));
    }
    await writeManifest(manifest);
    return entry;
  } catch (error) {
    const now = Date.now();
    const key = failureKey(candidate);
    const previous = manifest.failures[key];
    const retryCount = (previous?.retryCount ?? 0) + 1;
    const delay = Math.min(MAX_RETRY_DELAY_MS, 2 ** Math.min(retryCount, 8) * 60 * 1000);
    const message = error instanceof Error ? error.message : String(error);
    manifest.failures[key] = {
      id: key,
      provider: candidate.provider,
      mediaUrl: candidate.mediaUrl,
      sourceUrl: candidate.sourceUrl,
      postId: candidate.postId,
      message,
      failedAt: now,
      retryCount,
      nextRetryAt: now + delay,
    };
    manifest.providers[candidate.provider].lastError = message;
    await writeManifest(manifest);
    return null;
  }
}

function mediaTypeAt(types: FeedItem["content"]["mediaTypes"], index: number): "image" | "video" | "unknown" {
  const type = types[index];
  return type === "image" || type === "video" ? type : "unknown";
}

function profileUrlFromItem(item: FeedItem): string | undefined {
  if (item.platform === "instagram" && item.author.handle && item.author.handle !== "unknown") {
    return `https://www.instagram.com/${item.author.handle.replace(/^@/, "")}/`;
  }
  if (item.platform === "facebook" && item.author.handle && item.author.handle !== "unknown") {
    const handle = item.author.handle.replace(/^fb:/, "");
    if (handle && handle !== "unknown") return `https://www.facebook.com/${handle}`;
  }
  return undefined;
}

export async function upsertMediaVaultRosterFromItems(
  provider: MediaVaultProvider,
  items: FeedItem[],
): Promise<void> {
  const manifest = await readMediaVaultManifest();
  let changed = false;
  for (const item of items) {
    if (item.platform !== provider) continue;
    const key = `${provider}:${item.author.id}`;
    const now = Date.now();
    const existing = manifest.roster[key];
    manifest.roster[key] = {
      id: key,
      provider,
      externalId: item.author.id,
      handle: item.author.handle,
      displayName: item.author.displayName,
      profileUrl: existing?.profileUrl ?? profileUrlFromItem(item),
      firstSeenAt: existing?.firstSeenAt ?? item.capturedAt ?? now,
      lastSeenAt: Math.max(existing?.lastSeenAt ?? 0, item.capturedAt ?? now),
      source: "captured_item",
    };
    changed = true;

    if (provider === "facebook" && item.fbGroup) {
      const groupKey = `facebook:group:${item.fbGroup.id}`;
      const groupExisting = manifest.roster[groupKey];
      manifest.roster[groupKey] = {
        id: groupKey,
        provider,
        groupId: item.fbGroup.id,
        groupName: item.fbGroup.name,
        groupUrl: item.fbGroup.url,
        firstSeenAt: groupExisting?.firstSeenAt ?? item.capturedAt ?? now,
        lastSeenAt: Math.max(groupExisting?.lastSeenAt ?? 0, item.capturedAt ?? now),
        source: "facebook_group",
      };
      changed = true;
    }
  }
  if (changed) await writeManifest(manifest);
}

export async function archiveRecentProviderMedia(
  provider: MediaVaultProvider,
  items: FeedItem[],
  importSource: MediaVaultImportSource = "continuous",
): Promise<number> {
  const manifest = await readMediaVaultManifest();
  const state = manifest.providers[provider];
  if (!state.enabled) return 0;
  const ownerHandles = new Set(state.ownerHandles.map((handle) => handle.replace(/^@/, "")));
  if (ownerHandles.size === 0) return 0;

  let archived = 0;
  const candidates: MediaVaultCandidate[] = [];
  for (const item of items) {
    if (item.platform !== provider) continue;
    const handle = item.author.handle.replace(/^@/, "");
    if (!ownerHandles.has(handle)) continue;
    item.content.mediaUrls.forEach((mediaUrl, index) => {
      candidates.push({
        provider,
        mediaUrl,
        mediaType: mediaTypeAt(item.content.mediaTypes, index),
        postId: item.globalId,
        sourceUrl: item.sourceUrl,
        capturedAt: item.capturedAt,
        importSource,
        ownerHandle: handle,
      });
    });
  }

  for (const candidate of candidates) {
    const entry = await archiveMediaVaultCandidate(candidate);
    if (entry) archived += 1;
  }
  await upsertMediaVaultRosterFromItems(provider, items);
  return archived;
}

export async function summarizeMediaVault(provider: MediaVaultProvider): Promise<MediaVaultSummary> {
  const manifest = await readMediaVaultManifest();
  const entries = Object.values(manifest.entries).filter((entry) => entry.provider === provider);
  const failureCount = Object.values(manifest.failures).filter((failure) => failure.provider === provider).length;
  return {
    enabled: manifest.providers[provider].enabled,
    fileCount: entries.length,
    byteSize: entries.reduce((sum, entry) => sum + entry.byteSize, 0),
    lastSuccessAt: manifest.providers[provider].lastSuccessAt,
    lastError: manifest.providers[provider].lastError,
    failureCount,
    ownerHandles: manifest.providers[provider].ownerHandles,
  };
}

export function subscribeMediaVault(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

import JSZip from "jszip";
import {
  addMediaVaultOwnerHandle,
  archiveMediaVaultCandidate,
  type MediaVaultProvider,
} from "./media-vault";

export interface MetaExportImportSummary {
  provider: MediaVaultProvider;
  filesScanned: number;
  mediaFilesFound: number;
  imported: number;
  skipped: number;
  failed: number;
  ownerHandles: string[];
}

const MEDIA_EXTENSION_RE = /\.(?:jpg|jpeg|png|gif|webp|heic|mp4|mov|m4v|webm)$/i;
const VIDEO_EXTENSION_RE = /\.(?:mp4|mov|m4v|webm)$/i;
const IMAGE_EXTENSION_RE = /\.(?:jpg|jpeg|png|gif|webp|heic)$/i;

function mediaTypeForPath(path: string): "image" | "video" | "unknown" {
  if (VIDEO_EXTENSION_RE.test(path)) return "video";
  if (IMAGE_EXTENSION_RE.test(path)) return "image";
  return "unknown";
}

function isLikelyMetaMediaPath(path: string): boolean {
  const normalized = path.toLowerCase();
  if (!MEDIA_EXTENSION_RE.test(normalized)) return false;
  if (normalized.includes("__macosx/")) return false;
  if (normalized.includes("messages/") || normalized.includes("inbox/")) return false;
  if (normalized.includes("/profile_picture/")) return true;
  return (
    normalized.includes("media") ||
    normalized.includes("photo") ||
    normalized.includes("video") ||
    normalized.includes("posts") ||
    normalized.includes("reels") ||
    normalized.includes("stories") ||
    normalized.includes("albums")
  );
}

function postIdFromPath(path: string): string | undefined {
  const clean = path.replace(/\\/g, "/");
  const parts = clean.split("/").filter(Boolean);
  const file = parts.at(-1);
  if (!file) return undefined;
  return file.replace(/\.[^.]+$/, "");
}

function visitJson(value: unknown, visit: (key: string, value: unknown) => void, key = ""): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visitJson(item, visit, key));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    visit(childKey, childValue);
    visitJson(childValue, visit, childKey);
  }
}

async function discoverOwnerHandles(zip: JSZip, provider: MediaVaultProvider): Promise<string[]> {
  const handles = new Set<string>();
  const jsonFiles = Object.values(zip.files).filter((entry) =>
    !entry.dir && entry.name.toLowerCase().endsWith(".json")
  );

  for (const entry of jsonFiles.slice(0, 80)) {
    try {
      const parsed = JSON.parse(await entry.async("string")) as unknown;
      visitJson(parsed, (key, value) => {
        if (typeof value !== "string") return;
        const lowerKey = key.toLowerCase();
        if (
          lowerKey === "username" ||
          lowerKey === "handle" ||
          lowerKey === "profile_uri" ||
          lowerKey === "profile_url"
        ) {
          const match = provider === "instagram"
            ? value.match(/(?:instagram\.com\/)?@?([A-Za-z0-9._]{2,30})\/?$/)
            : value.match(/(?:facebook\.com\/)?@?([A-Za-z0-9._-]{2,80})\/?$/);
          if (match?.[1]) handles.add(match[1].replace(/^@/, ""));
        }
      });
    } catch {
      // Meta export JSON varies over time. Ignore files that are not plain JSON.
    }
  }

  return Array.from(handles).sort((a, b) => a.localeCompare(b));
}

export async function importMetaExportFiles(
  provider: MediaVaultProvider,
  files: FileList | File[],
): Promise<MetaExportImportSummary> {
  const summary: MetaExportImportSummary = {
    provider,
    filesScanned: files.length,
    mediaFilesFound: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    ownerHandles: [],
  };

  for (const file of Array.from(files)) {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      summary.skipped += 1;
      continue;
    }

    const zip = await JSZip.loadAsync(file);
    const ownerHandles = await discoverOwnerHandles(zip, provider);
    for (const handle of ownerHandles) {
      await addMediaVaultOwnerHandle(provider, handle);
    }
    summary.ownerHandles = Array.from(new Set([...summary.ownerHandles, ...ownerHandles]))
      .sort((a, b) => a.localeCompare(b));

    const mediaEntries = Object.values(zip.files).filter((entry) =>
      !entry.dir && isLikelyMetaMediaPath(entry.name)
    );
    summary.mediaFilesFound += mediaEntries.length;

    for (const entry of mediaEntries) {
      try {
        const bytes = await entry.async("uint8array");
        const saved = await archiveMediaVaultCandidate({
          provider,
          bytes,
          mediaType: mediaTypeForPath(entry.name),
          postId: postIdFromPath(entry.name),
          capturedAt: Date.now(),
          importSource: "meta_export",
          originalPath: entry.name,
          ownerHandle: ownerHandles[0],
        });
        if (saved) {
          summary.imported += 1;
        } else {
          summary.skipped += 1;
        }
      } catch {
        summary.failed += 1;
      }
    }
  }

  return summary;
}

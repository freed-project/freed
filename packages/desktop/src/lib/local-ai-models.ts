import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  open as openFile,
  readFile,
  readTextFile,
  remove,
  rename,
  size as fsSize,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type {
  LocalAIModelId,
  LocalAIModelHealth,
  LocalAIModelInstallState,
  LocalAIModelManifestEntry,
} from "@freed/shared";
import type {
  LocalAIModelDownloadProgress,
  LocalAIModelViewState,
} from "@freed/ui/context";

const STATE_VERSION = 1;
const MODEL_ROOT_DIR = "local-ai-models";
const STATE_FILE = "state.json";

export const LOCAL_AI_MODEL_MANIFEST: readonly LocalAIModelManifestEntry[] = [
  {
    id: "integrated-local-ai",
    title: "Integrated AI local pack",
    capability: "Search and summaries",
    description: "Downloads the local pack Freed uses for semantic matching, summaries, and extraction.",
    repo: "onnx-community/embeddinggemma-300m-ONNX",
    revision: "5090578d9565bb06545b4552f76e6bc2c93e4a66",
    sourceUrl: "https://huggingface.co/onnx-community",
    estimatedDownloadBytes: 778_176_031,
    estimatedStorageBytes: 778_176_031,
    hardwareNote: "WebGPU is used for summaries. Semantic matching can fall back for smaller libraries.",
    requiresWebGPU: false,
    wasmFallback: true,
    files: [
      { path: "config.json", sizeBytes: 1_765, sha1: "642d36a14c0399cb650a398e8a144aec0cb1f9ed", etag: "edb6342fb0d447a42960920034c773ddd6ed6d55" },
      { path: "onnx/model_q4.onnx", sizeBytes: 519_322, sha256: "ad1dfee81a70f7944b9b9d1cc6e48075b832881cf33fab2f2b248be78f3f0043" },
      { path: "onnx/model_q4.onnx_data", sizeBytes: 196_725_760, sha256: "599962c3143b040de2dd05e5975be3e9091dd067cacc6a8f7186e3203bab9e02" },
      { path: "special_tokens_map.json", sizeBytes: 662, sha1: "c68a97cd335d5d3ba89873356d789916f6a3e304", etag: "1a6193244714d3d78be48666cb02cdbfac62ad86" },
      { path: "tokenizer.json", sizeBytes: 20_323_312, sha256: "4dda02faaf32bc91031dc8c88457ac272b00c1016cc679757d1c441b248b9c47" },
      { path: "tokenizer.model", sizeBytes: 4_689_074, sha256: "1299c11d7cf632ef3b4e11937501358ada021bbdf7c47638d13c0ee982f2e79c" },
      { path: "tokenizer_config.json", sizeBytes: 1_156_830, sha1: "545813b40d80d9c3b66a94a62aa52d201eb62ef3", etag: "73b499ae604d0bcbeb2889639a42f46462e9d372" },
      { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/chat_template.jinja", sizeBytes: 4_168, sha1: "b066ba71c1b579388fd5a74a44bfe0fc582cf715", etag: "01be9b307daa2d425f7c168c9fb145a286e0afb4", repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "da1453100cf3ff33ef56d17983fc7a8648706db6" },
      { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/config.json", sizeBytes: 9_033, sha1: "b13fd212b2f112112f478b1fe7a73ba4bde53131", etag: "d0a1f0936e40260ebc455b29c1f8e02364852e4e", repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "da1453100cf3ff33ef56d17983fc7a8648706db6" },
      { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/genai_config.json", sizeBytes: 1_752, sha1: "f30d5e22b7e7f3f8c9102b9ec586d700ba08e414", etag: "51c41d433774036fecd682183abe686f19f9441e", repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "da1453100cf3ff33ef56d17983fc7a8648706db6" },
      { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/model.onnx", sizeBytes: 543_321_042, sha256: "5e9fb386cb1a14009b02b43b0e0f0043e248ad5a6d3c3521c9a516062509909a", repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "da1453100cf3ff33ef56d17983fc7a8648706db6" },
      { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/tokenizer.json", sizeBytes: 11_422_648, sha256: "979d160e081df25a1bf7f4e2e8f4c441b5dfdc9a8e84aec9f32e80445e1b59b8", repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "da1453100cf3ff33ef56d17983fc7a8648706db6" },
      { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/tokenizer_config.json", sizeBytes: 663, sha1: "3be0ca3b160c42f21c4f3b0b3b77a2f5de9d846c", etag: "eeb7009b684350496c7020a205e8ee025d9ee159", repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "da1453100cf3ff33ef56d17983fc7a8648706db6" },
    ],
  },
];

type PersistedState = {
  version: number;
  models: Partial<Record<LocalAIModelId, LocalAIModelInstallState>>;
};

type WritableFile = {
  write(data: Uint8Array): Promise<number>;
  close(): Promise<void>;
};

export interface LocalAIModelServiceDeps {
  appDataDir: () => Promise<string>;
  exists: (path: string) => Promise<boolean>;
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  open: (path: string, options: { write?: boolean; append?: boolean; create?: boolean; truncate?: boolean }) => Promise<WritableFile>;
  readFile: (path: string) => Promise<Uint8Array>;
  readTextFile: (path: string) => Promise<string>;
  remove: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  size: (path: string) => Promise<number>;
  writeTextFile: (path: string, text: string) => Promise<void>;
  fetch: typeof fetch;
  now: () => number;
  sha256File: (path: string) => Promise<string>;
  webGPUAvailable: () => boolean;
}

const defaultDeps: LocalAIModelServiceDeps = {
  appDataDir,
  exists,
  mkdir,
  open: openFile,
  readFile,
  readTextFile,
  remove,
  rename,
  size: fsSize,
  writeTextFile,
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  sha256File: (path) => invoke<string>("sha256_file", { path }),
  webGPUAvailable: () =>
    typeof navigator !== "undefined" &&
    typeof navigator === "object" &&
    "gpu" in navigator,
};

function findManifestEntry(
  manifest: readonly LocalAIModelManifestEntry[],
  id: LocalAIModelId,
): LocalAIModelManifestEntry {
  const entry = manifest.find((model) => model.id === id);
  if (!entry) throw new Error(`Unknown local AI model: ${id}`);
  return entry;
}

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => {
      if (index === 0) return part.replace(/\/+$/g, "");
      return part.replace(/^\/+|\/+$/g, "");
    })
    .filter(Boolean)
    .join("/");
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "" : path.slice(0, index);
}

async function digest(algorithm: "SHA-1" | "SHA-256", bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest(algorithm, input);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function defaultState(
  manifest: LocalAIModelManifestEntry,
  now: number,
  webGPUAvailable: boolean,
): LocalAIModelInstallState {
  return {
    id: manifest.id,
    status: manifest.requiresWebGPU && !manifest.wasmFallback && !webGPUAvailable
      ? "unsupported"
      : "not_downloaded",
    revision: manifest.revision,
    downloadedBytes: 0,
    totalBytes: manifest.estimatedDownloadBytes,
    storageBytes: 0,
    updatedAt: now,
    health: {
      lastIndexedItemCount: 0,
      failureCount: 0,
    },
  };
}

function cleanState(
  manifest: LocalAIModelManifestEntry,
  state: LocalAIModelInstallState | undefined,
  now: number,
  webGPUAvailable: boolean,
): LocalAIModelInstallState {
  if (!state) return defaultState(manifest, now, webGPUAvailable);
  if (state.status === "available") return state;
  if (manifest.requiresWebGPU && !manifest.wasmFallback && !webGPUAvailable) {
    return { ...state, status: "unsupported", updatedAt: now };
  }
  if (state.status === "unsupported") {
    return { ...state, status: "not_downloaded", updatedAt: now };
  }
  return state;
}

export function createLocalAIModelService(
  deps: LocalAIModelServiceDeps = defaultDeps,
  manifest: readonly LocalAIModelManifestEntry[] = LOCAL_AI_MODEL_MANIFEST,
) {
  const activeDownloads = new Map<LocalAIModelId, AbortController>();
  const byId = (id: LocalAIModelId) => findManifestEntry(manifest, id);

  async function rootDir(): Promise<string> {
    return joinPath(await deps.appDataDir(), MODEL_ROOT_DIR);
  }

  async function statePath(): Promise<string> {
    return joinPath(await rootDir(), STATE_FILE);
  }

  async function modelDir(model: LocalAIModelManifestEntry): Promise<string> {
    return joinPath(await rootDir(), model.id, model.revision);
  }

  async function filePath(model: LocalAIModelManifestEntry, path: string): Promise<string> {
    return joinPath(await modelDir(model), path);
  }

  async function loadPersisted(): Promise<PersistedState> {
    try {
      const raw = await deps.readTextFile(await statePath());
      const parsed = JSON.parse(raw) as PersistedState;
      return {
        version: STATE_VERSION,
        models: parsed.models ?? {},
      };
    } catch {
      return { version: STATE_VERSION, models: {} };
    }
  }

  async function savePersisted(state: PersistedState): Promise<void> {
    const root = await rootDir();
    await deps.mkdir(root, { recursive: true });
    await deps.writeTextFile(await statePath(), JSON.stringify({ ...state, version: STATE_VERSION }, null, 2));
  }

  async function updateModelState(
    id: LocalAIModelId,
    update: (current: LocalAIModelInstallState) => LocalAIModelInstallState,
  ): Promise<LocalAIModelInstallState> {
    const persisted = await loadPersisted();
    const entry = byId(id);
    const current = cleanState(entry, persisted.models[id], deps.now(), deps.webGPUAvailable());
    const next = update(current);
    persisted.models[id] = next;
    await savePersisted(persisted);
    return next;
  }

  async function listModels(): Promise<LocalAIModelViewState[]> {
    const persisted = await loadPersisted();
    const webGPUAvailable = deps.webGPUAvailable();
    return manifest.map((entry) => ({
      manifest: entry,
      state: cleanState(entry, persisted.models[entry.id], deps.now(), webGPUAvailable),
      webGPUAvailable,
    }));
  }

  async function measuredDownloadedBytes(model: LocalAIModelManifestEntry): Promise<number> {
    let downloadedBytes = 0;

    for (const file of model.files) {
      const target = await filePath(model, file.path);
      const partial = `${target}.partial`;

      if (await deps.exists(target)) {
        downloadedBytes += Math.min(await deps.size(target), file.sizeBytes);
        continue;
      }

      if (await deps.exists(partial)) {
        downloadedBytes += Math.min(await deps.size(partial), file.sizeBytes);
      }
    }

    return downloadedBytes;
  }

  async function verifyFile(path: string, file: LocalAIModelManifestEntry["files"][number]): Promise<void> {
    const actualSize = await deps.size(path);
    if (actualSize !== file.sizeBytes) {
      throw new Error(`Expected ${file.sizeBytes.toLocaleString()} bytes for ${file.path}, got ${actualSize.toLocaleString()}`);
    }

    if (file.sha256) {
      const actual = await deps.sha256File(path);
      if (actual !== file.sha256) {
        throw new Error(`Checksum failed for ${file.path}`);
      }
      return;
    }

    if (file.sha1) {
      const bytes = await deps.readFile(path);
      const actual = await digest("SHA-1", bytes);
      if (actual !== file.sha1) {
        throw new Error(`Checksum failed for ${file.path}`);
      }
    }
  }

  async function writeResponseBody(
    response: Response,
    handle: WritableFile,
    onChunk: (bytes: number) => void,
  ): Promise<void> {
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      await handle.write(bytes);
      onChunk(bytes.byteLength);
      return;
    }

    const reader = response.body.getReader();
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      if (!next.value) continue;
      await handle.write(next.value);
      onChunk(next.value.byteLength);
    }
  }

  async function downloadFile(input: {
    model: LocalAIModelManifestEntry;
    file: LocalAIModelManifestEntry["files"][number];
    signal: AbortSignal;
    completedBeforeFile: number;
    totalBytes: number;
    onProgress?: (progress: LocalAIModelDownloadProgress) => void;
  }): Promise<number> {
    const { model, file, signal, completedBeforeFile, totalBytes, onProgress } = input;
    const target = await filePath(model, file.path);
    const partial = `${target}.partial`;
    const parent = dirname(target);
    if (parent) await deps.mkdir(parent, { recursive: true });

    if (await deps.exists(target)) {
      await verifyFile(target, file);
      onProgress?.({
        id: model.id,
        currentFile: file.path,
        downloadedBytes: completedBeforeFile + file.sizeBytes,
        totalBytes,
      });
      return file.sizeBytes;
    }

    let existingPartialBytes = 0;
    if (await deps.exists(partial)) {
      existingPartialBytes = await deps.size(partial);
      if (existingPartialBytes > file.sizeBytes) {
        await deps.remove(partial);
        existingPartialBytes = 0;
      }
    }

    const headers = new Headers();
    if (existingPartialBytes > 0) {
      headers.set("Range", `bytes=${existingPartialBytes}-`);
    }

    const fileRepo = file.repo ?? model.repo;
    const fileRevision = file.revision ?? model.revision;
    const url = `https://huggingface.co/${fileRepo}/resolve/${fileRevision}/${file.path}`;
    let response = await deps.fetch(url, { headers, signal });
    if (response.status === 416 && existingPartialBytes > 0) {
      await deps.remove(partial);
      existingPartialBytes = 0;
      response = await deps.fetch(url, { signal });
    }
    if (!response.ok && response.status !== 206) {
      throw new Error(`Download failed for ${file.path}: ${response.status}`);
    }

    const canAppend = existingPartialBytes > 0 && response.status === 206;
    if (existingPartialBytes > 0 && !canAppend) {
      await deps.remove(partial);
      existingPartialBytes = 0;
    }

    const handle = await deps.open(partial, {
      write: true,
      create: true,
      append: canAppend,
      truncate: !canAppend,
    });

    let writtenForFile = existingPartialBytes;
    try {
      await writeResponseBody(response, handle, (bytes) => {
        writtenForFile += bytes;
        onProgress?.({
          id: model.id,
          currentFile: file.path,
          downloadedBytes: completedBeforeFile + writtenForFile,
          totalBytes,
        });
      });
    } finally {
      await handle.close();
    }

    await verifyFile(partial, file);
    if (await deps.exists(target)) {
      await deps.remove(target);
    }
    await deps.rename(partial, target);
    return file.sizeBytes;
  }

  async function downloadModel(
    id: LocalAIModelId,
    onProgress?: (progress: LocalAIModelDownloadProgress) => void,
  ): Promise<LocalAIModelViewState[]> {
    const model = byId(id);
    const webGPUAvailable = deps.webGPUAvailable();
    if (model.requiresWebGPU && !model.wasmFallback && !webGPUAvailable) {
      await updateModelState(id, (current) => ({
        ...current,
        status: "unsupported",
        updatedAt: deps.now(),
        lastError: "WebGPU is required for this model pack.",
      }));
      return listModels();
    }

    activeDownloads.get(id)?.abort();
    const controller = new AbortController();
    activeDownloads.set(id, controller);

    const totalBytes = model.files.reduce((sum, file) => sum + file.sizeBytes, 0);
    await updateModelState(id, (current) => ({
      ...current,
      status: "downloading",
      revision: model.revision,
      downloadedBytes: 0,
      totalBytes,
      lastError: undefined,
      updatedAt: deps.now(),
    }));

    let completedBytes = 0;
    try {
      for (const file of model.files) {
        const downloaded = await downloadFile({
          model,
          file,
          signal: controller.signal,
          completedBeforeFile: completedBytes,
          totalBytes,
          onProgress,
        });
        completedBytes += downloaded;
        await updateModelState(id, (current) => ({
          ...current,
          downloadedBytes: completedBytes,
          totalBytes,
          updatedAt: deps.now(),
        }));
      }

      const dir = await modelDir(model);
      const storageBytes = await deps.size(dir).catch(() => completedBytes);
      await updateModelState(id, (current) => ({
        ...current,
        status: "available",
        downloadedBytes: totalBytes,
        totalBytes,
        storageBytes,
        installedAt: deps.now(),
        updatedAt: deps.now(),
        lastError: undefined,
      }));
    } catch (error) {
      const aborted = controller.signal.aborted;
      const downloadedBytes = aborted
        ? await measuredDownloadedBytes(model)
        : completedBytes;
      await updateModelState(id, (current) => ({
        ...current,
        status: aborted ? "paused" : "error",
        downloadedBytes,
        totalBytes,
        updatedAt: deps.now(),
        lastError: aborted
          ? undefined
          : error instanceof Error
            ? error.message
            : String(error),
      }));
    } finally {
      if (activeDownloads.get(id) === controller) {
        activeDownloads.delete(id);
      }
    }

    return listModels();
  }

  async function pauseDownload(id: LocalAIModelId): Promise<LocalAIModelViewState[]> {
    activeDownloads.get(id)?.abort();
    await updateModelState(id, (current) => ({
      ...current,
      status: current.status === "downloading" ? "paused" : current.status,
      updatedAt: deps.now(),
    }));
    return listModels();
  }

  async function removeModel(id: LocalAIModelId): Promise<LocalAIModelViewState[]> {
    activeDownloads.get(id)?.abort();
    const model = byId(id);
    const dir = joinPath(await rootDir(), model.id);
    if (await deps.exists(dir)) {
      await deps.remove(dir, { recursive: true });
    }
    await updateModelState(id, () => defaultState(model, deps.now(), deps.webGPUAvailable()));
    return listModels();
  }

  async function updateHealth(
    id: LocalAIModelId,
    health: LocalAIModelHealth,
  ): Promise<LocalAIModelViewState[]> {
    await updateModelState(id, (current) => ({
      ...current,
      health: {
        ...current.health,
        ...health,
      },
      updatedAt: deps.now(),
    }));
    return listModels();
  }

  return {
    listModels,
    downloadModel,
    pauseDownload,
    removeModel,
    updateHealth,
  };
}

export const localAIModels = createLocalAIModelService();

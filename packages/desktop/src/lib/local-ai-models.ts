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
  LocalAIHardwareProfile,
  LocalAIModelId,
  LocalAIModelHealth,
  LocalAIModelInstallState,
  LocalAIModelManifestEntry,
} from "@freed/shared";
import {
  LOCAL_AI_BALANCED_PACK_ID,
  LOCAL_AI_LIGHT_PACK_ID,
  LOCAL_AI_PRO_PACK_ID,
} from "@freed/shared";
import type {
  LocalAIModelDownloadProgress,
  LocalAIModelViewState,
} from "@freed/ui/context";

const STATE_VERSION = 1;
const MODEL_ROOT_DIR = "local-ai-models";
const STATE_FILE = "state.json";
const MIN_STREAM_WRITE_BYTES = 1024 * 1024;
const MIN_PROGRESS_INTERVAL_MS = 250;
const LEGACY_LOCAL_AI_MODEL_ID: LocalAIModelId = "integrated-local-ai";
type LocalAIModelStateSubscriber = () => void;
const localAIModelStateSubscribers = new Set<LocalAIModelStateSubscriber>();

export function subscribeToLocalAIModelState(callback: LocalAIModelStateSubscriber): () => void {
  localAIModelStateSubscribers.add(callback);
  return () => {
    localAIModelStateSubscribers.delete(callback);
  };
}

function notifyLocalAIModelState(): void {
  for (const callback of localAIModelStateSubscribers) {
    callback();
  }
}

const EMBEDDING_GEMMA_FILES: LocalAIModelManifestEntry["files"] = [
  { path: "config.json", sizeBytes: 1_765, sha1: "642d36a14c0399cb650a398e8a144aec0cb1f9ed", etag: "edb6342fb0d447a42960920034c773ddd6ed6d55" },
  { path: "onnx/model_q4.onnx", sizeBytes: 519_322, sha256: "ad1dfee81a70f7944b9b9d1cc6e48075b832881cf33fab2f2b248be78f3f0043" },
  { path: "onnx/model_q4.onnx_data", sizeBytes: 196_725_760, sha256: "599962c3143b040de2dd05e5975be3e9091dd067cacc6a8f7186e3203bab9e02" },
  { path: "special_tokens_map.json", sizeBytes: 662, sha1: "c68a97cd335d5d3ba89873356d789916f6a3e304", etag: "1a6193244714d3d78be48666cb02cdbfac62ad86" },
  { path: "tokenizer.json", sizeBytes: 20_323_312, sha256: "4dda02faaf32bc91031dc8c88457ac272b00c1016cc679757d1c441b248b9c47" },
  { path: "tokenizer.model", sizeBytes: 4_689_074, sha256: "1299c11d7cf632ef3b4e11937501358ada021bbdf7c47638d13c0ee982f2e79c" },
  { path: "tokenizer_config.json", sizeBytes: 1_156_830, sha1: "545813b40d80d9c3b66a94a62aa52d201eb62ef3", etag: "73b499ae604d0bcbeb2889639a42f46462e9d372" },
];

const QWEN3_06B_Q4_FILES: LocalAIModelManifestEntry["files"] = [
  { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/chat_template.jinja", sizeBytes: 4_168, sha1: "b066ba71c1b579388fd5a74a44bfe0fc582cf715", etag: "01be9b307daa2d425f7c168c9fb145a286e0afb4", repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "da1453100cf3ff33ef56d17983fc7a8648706db6" },
  { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/config.json", sizeBytes: 9_033, sha1: "b13fd212b2f112112f478b1fe7a73ba4bde53131", etag: "d0a1f0936e40260ebc455b29c1f8e02364852e4e", repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "da1453100cf3ff33ef56d17983fc7a8648706db6" },
  { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/genai_config.json", sizeBytes: 1_752, sha1: "f30d5e22b7e7f3f8c9102b9ec586d700ba08e414", etag: "51c41d433774036fecd682183abe686f19f9441e", repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "da1453100cf3ff33ef56d17983fc7a8648706db6" },
  { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/model.onnx", sizeBytes: 543_321_042, sha256: "5e9fb386cb1a14009b02b43b0e0f0043e248ad5a6d3c3521c9a516062509909a", repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "da1453100cf3ff33ef56d17983fc7a8648706db6" },
  { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/tokenizer.json", sizeBytes: 11_422_648, sha256: "979d160e081df25a1bf7f4e2e8f4c441b5dfdc9a8e84aec9f32e80445e1b59b8", repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "da1453100cf3ff33ef56d17983fc7a8648706db6" },
  { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/tokenizer_config.json", sizeBytes: 663, sha1: "3be0ca3b160c42f21c4f3b0b3b77a2f5de9d846c", etag: "eeb7009b684350496c7020a205e8ee025d9ee159", repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "da1453100cf3ff33ef56d17983fc7a8648706db6" },
];

const GEMMA4_E2B_Q4_TEXT_FILES: LocalAIModelManifestEntry["files"] = [
  { path: "gemma4/chat_template.jinja", sourcePath: "chat_template.jinja", sizeBytes: 16_317, sha1: "47b6091be3b1c21cc709fa73062b06d1ae6ef2c5", repo: "onnx-community/gemma-4-E2B-it-ONNX", revision: "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6" },
  { path: "gemma4/config.json", sourcePath: "config.json", sizeBytes: 5_549, sha1: "f03bd45c7eeefe52589e62a23ec142b688ba9799", repo: "onnx-community/gemma-4-E2B-it-ONNX", revision: "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6" },
  { path: "gemma4/generation_config.json", sourcePath: "generation_config.json", sizeBytes: 238, sha1: "46cf108504be46f85caeac7cdc8da95198cc9e3a", repo: "onnx-community/gemma-4-E2B-it-ONNX", revision: "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6" },
  { path: "gemma4/onnx/decoder_model_merged_q4.onnx", sizeBytes: 647_599, sha256: "c6edb929bf342c524728d37efd400285ee71525e8fe64ff996341f78c3e577d2", repo: "onnx-community/gemma-4-E2B-it-ONNX", revision: "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6", sourcePath: "onnx/decoder_model_merged_q4.onnx" },
  { path: "gemma4/onnx/decoder_model_merged_q4.onnx_data", sizeBytes: 1_864_102_912, sha256: "b879fe4b946c9b9ff6acb60f7c5eda3d2c9c4df8625895feb2d1e269002f0345", repo: "onnx-community/gemma-4-E2B-it-ONNX", revision: "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6", sourcePath: "onnx/decoder_model_merged_q4.onnx_data" },
  { path: "gemma4/onnx/embed_tokens_q4.onnx", sizeBytes: 5_142, sha256: "2d8c8a2bcc30e8ded7f636967c2a58a346116583356dd933720b005fc88079c4", repo: "onnx-community/gemma-4-E2B-it-ONNX", revision: "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6", sourcePath: "onnx/embed_tokens_q4.onnx" },
  { path: "gemma4/onnx/embed_tokens_q4.onnx_data", sizeBytes: 1_762_656_256, sha256: "40fa957d9988b8a0160c8b0eb5c3f781a237627e9f7153f30514a4ffb2e62888", repo: "onnx-community/gemma-4-E2B-it-ONNX", revision: "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6", sourcePath: "onnx/embed_tokens_q4.onnx_data" },
  { path: "gemma4/tokenizer.json", sizeBytes: 19_439_251, sha256: "47bd35616c7c782aaca6ccf48c75f3461d5877170984b8836b375107d0a9f566", repo: "onnx-community/gemma-4-E2B-it-ONNX", revision: "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6", sourcePath: "tokenizer.json" },
  { path: "gemma4/tokenizer_config.json", sourcePath: "tokenizer_config.json", sizeBytes: 18_807, sha1: "34fcd7e03f78a7fefacc4be234950daa1aab9ac9", repo: "onnx-community/gemma-4-E2B-it-ONNX", revision: "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6" },
];

function sumFileBytes(files: LocalAIModelManifestEntry["files"]): number {
  return files.reduce((sum, file) => sum + file.sizeBytes, 0);
}

export const LOCAL_AI_MODEL_MANIFEST: readonly LocalAIModelManifestEntry[] = [
  {
    id: LOCAL_AI_LIGHT_PACK_ID,
    tier: "light",
    title: "Light",
    capability: "Search and ranking",
    description: "Semantic search, topics, and ranking for smaller libraries and lower-memory machines.",
    repo: "onnx-community/embeddinggemma-300m-ONNX",
    revision: "5090578d9565bb06545b4552f76e6bc2c93e4a66",
    sourceUrl: "https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX",
    estimatedDownloadBytes: sumFileBytes(EMBEDDING_GEMMA_FILES),
    estimatedStorageBytes: sumFileBytes(EMBEDDING_GEMMA_FILES),
    hardwareNote: "Recommended for under 12 GB RAM, missing WebGPU, or smaller libraries.",
    requiresWebGPU: false,
    wasmFallback: true,
    supportsSemanticSearch: true,
    supportsSummaries: false,
    supportsAssistant: false,
    files: EMBEDDING_GEMMA_FILES,
  },
  {
    id: LOCAL_AI_BALANCED_PACK_ID,
    tier: "balanced",
    title: "Balanced",
    capability: "Search and summaries",
    description: "Downloads the local pack Freed uses for semantic matching, summaries, and extraction.",
    repo: "onnx-community/embeddinggemma-300m-ONNX",
    revision: "5090578d9565bb06545b4552f76e6bc2c93e4a66",
    sourceUrl: "https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX",
    estimatedDownloadBytes: sumFileBytes([...EMBEDDING_GEMMA_FILES, ...QWEN3_06B_Q4_FILES]),
    estimatedStorageBytes: sumFileBytes([...EMBEDDING_GEMMA_FILES, ...QWEN3_06B_Q4_FILES]),
    hardwareNote: "Recommended for 12 GB to 23 GB RAM with WebGPU.",
    requiresWebGPU: false,
    wasmFallback: true,
    supportsSemanticSearch: true,
    supportsSummaries: true,
    supportsAssistant: false,
    files: [...EMBEDDING_GEMMA_FILES, ...QWEN3_06B_Q4_FILES],
  },
  {
    id: LOCAL_AI_PRO_PACK_ID,
    tier: "pro",
    title: "Pro",
    capability: "Assistant ready",
    description: "Best local extraction and assistant workflows for high-memory machines.",
    repo: "onnx-community/embeddinggemma-300m-ONNX",
    revision: "5090578d9565bb06545b4552f76e6bc2c93e4a66",
    sourceUrl: "https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX",
    estimatedDownloadBytes: sumFileBytes([...EMBEDDING_GEMMA_FILES, ...GEMMA4_E2B_Q4_TEXT_FILES]),
    estimatedStorageBytes: sumFileBytes([...EMBEDDING_GEMMA_FILES, ...GEMMA4_E2B_Q4_TEXT_FILES]),
    hardwareNote: "Recommended for 24 GB or more RAM with WebGPU and ample local storage.",
    requiresWebGPU: true,
    wasmFallback: false,
    supportsSemanticSearch: true,
    supportsSummaries: true,
    supportsAssistant: true,
    files: [...EMBEDDING_GEMMA_FILES, ...GEMMA4_E2B_Q4_TEXT_FILES],
  },
];

type PersistedState = {
  version: number;
  selectedModelId?: LocalAIModelId;
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
  getHardwareProfile: () => Promise<LocalAIHardwareProfile | null>;
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
  getHardwareProfile: () => invoke<LocalAIHardwareProfile>("get_ai_hardware_profile", {
    webGpuAvailable:
      typeof navigator !== "undefined" &&
      typeof navigator === "object" &&
      "gpu" in navigator,
  }).catch(() => null),
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
      const migrated = await migratePersisted({
        version: STATE_VERSION,
        selectedModelId: parsed.selectedModelId,
        models: parsed.models ?? {},
      });
      return migrated;
    } catch {
      return { version: STATE_VERSION, models: {} };
    }
  }

  async function migratePersisted(state: PersistedState): Promise<PersistedState> {
    const legacy = state.models[LEGACY_LOCAL_AI_MODEL_ID];
    let changed = false;
    const next: PersistedState = {
      version: STATE_VERSION,
      selectedModelId: state.selectedModelId === LEGACY_LOCAL_AI_MODEL_ID
        ? LOCAL_AI_BALANCED_PACK_ID
        : state.selectedModelId,
      models: { ...state.models },
    };

    if (legacy && !next.models[LOCAL_AI_BALANCED_PACK_ID]) {
      next.models[LOCAL_AI_BALANCED_PACK_ID] = {
        ...legacy,
        id: LOCAL_AI_BALANCED_PACK_ID,
      };
      changed = true;
    }
    if (next.models[LEGACY_LOCAL_AI_MODEL_ID]) {
      delete next.models[LEGACY_LOCAL_AI_MODEL_ID];
      changed = true;
    }
    if (next.selectedModelId !== state.selectedModelId) {
      changed = true;
    }

    if (legacy) {
      const root = await rootDir();
      const legacyDir = joinPath(root, LEGACY_LOCAL_AI_MODEL_ID);
      const balancedDir = joinPath(root, LOCAL_AI_BALANCED_PACK_ID);
      if ((await deps.exists(legacyDir)) && !(await deps.exists(balancedDir))) {
        await deps.rename(legacyDir, balancedDir).catch(() => undefined);
      }
    }

    if (changed) {
      await deps.mkdir(await rootDir(), { recursive: true });
      await deps.writeTextFile(await statePath(), JSON.stringify(next, null, 2));
    }
    return next;
  }

  async function savePersisted(state: PersistedState): Promise<void> {
    const root = await rootDir();
    await deps.mkdir(root, { recursive: true });
    await deps.writeTextFile(await statePath(), JSON.stringify({ ...state, version: STATE_VERSION }, null, 2));
    notifyLocalAIModelState();
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
    const selectedModelId = persisted.selectedModelId ?? LOCAL_AI_BALANCED_PACK_ID;
    return manifest.map((entry) => ({
      manifest: entry,
      state: cleanState(entry, persisted.models[entry.id], deps.now(), webGPUAvailable),
      webGPUAvailable,
      selected: entry.id === selectedModelId,
    }));
  }

  async function selectModel(id: LocalAIModelId): Promise<LocalAIModelViewState[]> {
    byId(id);
    const persisted = await loadPersisted();
    persisted.selectedModelId = id;
    await savePersisted(persisted);
    return listModels();
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
    const pendingChunks: Uint8Array[] = [];
    let pendingBytes = 0;

    const flush = async () => {
      if (pendingBytes === 0) return;

      const bytes = pendingChunks.length === 1
        ? pendingChunks[0]
        : new Uint8Array(pendingBytes);

      if (pendingChunks.length > 1) {
        let offset = 0;
        for (const chunk of pendingChunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
      }

      pendingChunks.length = 0;
      pendingBytes = 0;
      await handle.write(bytes);
      onChunk(bytes.byteLength);
    };

    while (true) {
      const next = await reader.read();
      if (next.done) {
        await flush();
        return;
      }
      if (!next.value) continue;
      pendingChunks.push(next.value);
      pendingBytes += next.value.byteLength;
      if (pendingBytes >= MIN_STREAM_WRITE_BYTES) {
        await flush();
      }
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
    const sourcePath = file.sourcePath ?? file.path;
    const url = `https://huggingface.co/${fileRepo}/resolve/${fileRevision}/${sourcePath}`;
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
    let lastProgressAt = 0;
    const emitProgress = (force = false) => {
      const now = deps.now();
      if (!force && now - lastProgressAt < MIN_PROGRESS_INTERVAL_MS) return;
      lastProgressAt = now;
      onProgress?.({
        id: model.id,
        currentFile: file.path,
        downloadedBytes: completedBeforeFile + writtenForFile,
        totalBytes,
      });
    };

    try {
      await writeResponseBody(response, handle, (bytes) => {
        writtenForFile += bytes;
        emitProgress();
      });
      emitProgress(true);
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
    await selectModel(id);
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

  async function getHardwareProfile(): Promise<LocalAIHardwareProfile | null> {
    const profile = await deps.getHardwareProfile();
    if (!profile) return null;
    return {
      ...profile,
      webGPUAvailable: deps.webGPUAvailable(),
    };
  }

  return {
    listModels,
    selectModel,
    downloadModel,
    pauseDownload,
    removeModel,
    getHardwareProfile,
    updateHealth,
  };
}

export const localAIModels = createLocalAIModelService();

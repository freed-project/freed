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
    id: "semantic-embeddinggemma",
    title: "Semantic search and ranking",
    capability: "Embeddings",
    description: "Indexes saved items and feed text for local semantic matching.",
    repo: "onnx-community/embeddinggemma-300m-ONNX",
    revision: "5090578d9565bb06545b4552f76e6bc2c93e4a66",
    sourceUrl: "https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX",
    estimatedDownloadBytes: 223_000_000,
    estimatedStorageBytes: 223_000_000,
    hardwareNote: "Works best with WebGPU. CPU fallback is allowed for smaller libraries.",
    requiresWebGPU: false,
    wasmFallback: true,
    files: [
      { path: "config.json", sizeBytes: 1_765, sha1: "edb6342fb0d447a42960920034c773ddd6ed6d55" },
      { path: "onnx/model_q4.onnx", sizeBytes: 519_322, sha256: "ad1dfee81a70f7944b9b9d1cc6e48075b832881cf33fab2f2b248be78f3f0043" },
      { path: "onnx/model_q4.onnx_data", sizeBytes: 196_725_760, sha256: "599962c3143b040de2dd05e5975be3e9091dd067cacc6a8f7186e3203bab9e02" },
      { path: "special_tokens_map.json", sizeBytes: 662, sha1: "1a6193244714d3d78be48666cb02cdbfac62ad86" },
      { path: "tokenizer.json", sizeBytes: 20_323_312, sha256: "4dda02faaf32bc91031dc8c88457ac272b00c1016cc679757d1c441b248b9c47" },
      { path: "tokenizer.model", sizeBytes: 4_689_074, sha256: "1299c11d7cf632ef3b4e11937501358ada021bbdf7c47638d13c0ee982f2e79c" },
      { path: "tokenizer_config.json", sizeBytes: 1_156_830, sha1: "73b499ae604d0bcbeb2889639a42f46462e9d372" },
    ],
  },
  {
    id: "summary-qwen3",
    title: "Local summaries",
    capability: "Compact generation",
    description: "Downloads the compact local generation pack reserved for summary benchmarks.",
    repo: "onnx-community/Qwen3-0.6B-ONNX",
    revision: "da1453100cf3ff33ef56d17983fc7a8648706db6",
    sourceUrl: "https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX",
    estimatedDownloadBytes: 555_000_000,
    estimatedStorageBytes: 555_000_000,
    hardwareNote: "Requires WebGPU for acceptable latency in Freed Desktop.",
    requiresWebGPU: true,
    wasmFallback: false,
    files: [
      { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/chat_template.jinja", sizeBytes: 4_168, sha1: "01be9b307daa2d425f7c168c9fb145a286e0afb4" },
      { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/config.json", sizeBytes: 9_033, sha1: "d0a1f0936e40260ebc455b29c1f8e02364852e4e" },
      { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/genai_config.json", sizeBytes: 1_752, sha1: "51c41d433774036fecd682183abe686f19f9441e" },
      { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/model.onnx", sizeBytes: 543_321_042, sha256: "5e9fb386cb1a14009b02b43b0e0f0043e248ad5a6d3c3521c9a516062509909a" },
      { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/tokenizer.json", sizeBytes: 11_422_648, sha256: "979d160e081df25a1bf7f4e2e8f4c441b5dfdc9a8e84aec9f32e80445e1b59b8" },
      { path: "onnxruntime/webgpu/webgpu-int4-kld-block-32/tokenizer_config.json", sizeBytes: 663, sha1: "eeb7009b684350496c7020a205e8ee025d9ee159" },
    ],
  },
  {
    id: "assistant-gemma4",
    title: "Advanced local assistant",
    capability: "Gemma 4 E2B",
    description: "Downloads the large Gemma 4 E2B text pack for explicit local assistant experiments.",
    repo: "onnx-community/gemma-4-E2B-it-ONNX",
    revision: "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6",
    sourceUrl: "https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX",
    estimatedDownloadBytes: 3_140_000_000,
    estimatedStorageBytes: 3_140_000_000,
    hardwareNote: "Requires WebGPU and several gigabytes of free memory.",
    requiresWebGPU: true,
    wasmFallback: false,
    files: [
      { path: "chat_template.jinja", sizeBytes: 16_317, sha1: "07e50e69a8c445f2c31a089b828e85b2a93942bf" },
      { path: "config.json", sizeBytes: 5_549, sha1: "a7f7623b5229c8498655847bd9cdeea34e5017f6" },
      { path: "generation_config.json", sizeBytes: 238, sha1: "b2b0ab11eaf5317ad648bb48ce64b110532d661a" },
      { path: "preprocessor_config.json", sizeBytes: 43, sha1: "6418e09c5fdb500f7ad9e86a7de9de7e60317f34" },
      { path: "processor_config.json", sizeBytes: 1_689, sha1: "5465974d23e1eca2c46c2809b26c997946ce0d90" },
      { path: "tokenizer.json", sizeBytes: 19_439_251, sha256: "47bd35616c7c782aaca6ccf48c75f3461d5877170984b8836b375107d0a9f566" },
      { path: "tokenizer_config.json", sizeBytes: 18_807, sha1: "8dc6453271e40decb8ebdb68f4f9421d306dd6b3" },
      { path: "onnx/embed_tokens_q4f16.onnx", sizeBytes: 5_621, sha256: "d7ca53f6a169471b5699b2f57ee4c7aa2c73732b0152f3909e64b71384444825" },
      { path: "onnx/embed_tokens_q4f16.onnx_data", sizeBytes: 1_590_689_792, sha256: "024b199e6358ed42970f807686add5f9430d7e254ca7ce22fc9c83f015b9c517" },
      { path: "onnx/decoder_model_merged_q4f16.onnx", sizeBytes: 673_231, sha256: "73c0f1fe04f9a3a048fb3319c0671b6cf0346bf33a3a8624c853bcffe01c24a4" },
      { path: "onnx/decoder_model_merged_q4f16.onnx_data", sizeBytes: 1_519_700_992, sha256: "3b27245a7396cb7039a4e4118bd2a8aa35106bae381522edf7c4867b5f22bb10" },
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

    const url = `https://huggingface.co/${model.repo}/resolve/${model.revision}/${file.path}`;
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

  return {
    listModels,
    downloadModel,
    pauseDownload,
    removeModel,
  };
}

export const localAIModels = createLocalAIModelService();

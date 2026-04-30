import { describe, expect, it } from "vitest";
import * as A from "@automerge/automerge";
import type { LocalAIModelManifestEntry } from "@freed/shared";
import { createDefaultPreferences } from "@freed/shared";
import { createEmptyDoc } from "@freed/shared/schema";
import {
  createLocalAIModelService,
  type LocalAIModelServiceDeps,
} from "./local-ai-models";

const TEXT = new TextEncoder();
const HELLO_SHA1 = "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d";

const TEST_MANIFEST: readonly LocalAIModelManifestEntry[] = [
  {
    id: "integrated-local-ai",
    title: "Integrated AI local pack",
    capability: "Search and summaries",
    description: "Test model",
    repo: "test/model",
    revision: "abc123",
    sourceUrl: "https://example.com/model",
    estimatedDownloadBytes: 10,
    estimatedStorageBytes: 10,
    hardwareNote: "Test hardware",
    requiresWebGPU: false,
    wasmFallback: true,
    files: [
      { path: "model.bin", sizeBytes: 5, sha1: HELLO_SHA1 },
      { path: "metadata.json", sizeBytes: 5, sha1: HELLO_SHA1, etag: "blob-id-not-raw-sha1" },
    ],
  },
];

function createDeps(options: {
  responses?: Uint8Array[];
  webGPUAvailable?: boolean;
  seedFiles?: Record<string, string>;
  sha256?: string;
} = {}) {
  const files = new Map<string, Uint8Array>();
  const requests: Array<{ url: string; range: string | null }> = [];

  for (const [path, text] of Object.entries(options.seedFiles ?? {})) {
    files.set(path, TEXT.encode(text));
  }

  const deps: LocalAIModelServiceDeps = {
    appDataDir: async () => "/app",
    exists: async (path) => {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      return files.has(path) || Array.from(files.keys()).some((key) => key.startsWith(prefix));
    },
    mkdir: async () => {},
    open: async (path, openOptions) => {
      let chunks: Uint8Array[] = [];
      if (openOptions.append && files.has(path)) chunks = [files.get(path)!];
      if (openOptions.truncate) chunks = [];
      return {
        async write(data) {
          chunks.push(data);
          const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
          const next = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            next.set(chunk, offset);
            offset += chunk.byteLength;
          }
          files.set(path, next);
          return data.byteLength;
        },
        async close() {},
      };
    },
    readFile: async (path) => {
      const file = files.get(path);
      if (!file) throw new Error(`ENOENT: ${path}`);
      return file;
    },
    readTextFile: async (path) => {
      const file = files.get(path);
      if (!file) throw new Error(`ENOENT: ${path}`);
      return new TextDecoder().decode(file);
    },
    remove: async (path, removeOptions) => {
      files.delete(path);
      if (removeOptions?.recursive) {
        const prefix = path.endsWith("/") ? path : `${path}/`;
        for (const key of Array.from(files.keys())) {
          if (key.startsWith(prefix)) files.delete(key);
        }
      }
    },
    rename: async (oldPath, newPath) => {
      const file = files.get(oldPath);
      if (!file) throw new Error(`ENOENT: ${oldPath}`);
      files.set(newPath, file);
      files.delete(oldPath);
    },
    size: async (path) => {
      const file = files.get(path);
      if (file) return file.byteLength;
      const prefix = path.endsWith("/") ? path : `${path}/`;
      return Array.from(files.entries()).reduce(
        (sum, [key, value]) => sum + (key.startsWith(prefix) ? value.byteLength : 0),
        0,
      );
    },
    writeTextFile: async (path, text) => {
      files.set(path, TEXT.encode(text));
    },
    fetch: async (url, init) => {
      const range = init?.headers instanceof Headers ? init.headers.get("Range") : null;
      requests.push({ url: String(url), range });
      const next = options.responses?.shift() ?? TEXT.encode("hello");
      const body = next.buffer.slice(next.byteOffset, next.byteOffset + next.byteLength) as ArrayBuffer;
      return new Response(body, { status: range ? 206 : 200 });
    },
    now: () => 1_000,
    sha256File: async () => options.sha256 ?? "",
    webGPUAvailable: () => options.webGPUAvailable ?? true,
  };

  return { deps, files, requests };
}

function modelPath(path: string): string {
  return `/app/local-ai-models/integrated-local-ai/abc123/${path}`;
}

describe("local AI model manager", () => {
  it("keeps AI disabled by default", async () => {
    const { deps } = createDeps();
    const service = createLocalAIModelService(deps, TEST_MANIFEST);
    const models = await service.listModels();

    expect(createDefaultPreferences().ai).toEqual({
      provider: "none",
      model: "",
      autoSummarize: false,
      extractTopics: false,
    });
    expect(models[0].state.status).toBe("not_downloaded");
    expect(models[0].state.downloadedBytes).toBe(0);
  });

  it("downloads, verifies, and records an available model", async () => {
    const { deps, files } = createDeps();
    const service = createLocalAIModelService(deps, TEST_MANIFEST);

    const models = await service.downloadModel("integrated-local-ai");

    expect(models[0].state.status).toBe("available");
    expect(files.has(modelPath("model.bin"))).toBe(true);
    expect(files.has(modelPath("metadata.json"))).toBe(true);
    expect(models[0].state.storageBytes).toBe(10);
  });

  it("treats Hugging Face etags as metadata, not raw file checksums", async () => {
    const { deps } = createDeps();
    const service = createLocalAIModelService(deps, TEST_MANIFEST);

    const models = await service.downloadModel("integrated-local-ai");

    expect(models[0].state.status).toBe("available");
    expect(TEST_MANIFEST[0].files[1].etag).not.toBe(TEST_MANIFEST[0].files[1].sha1);
  });

  it("records checksum failures without marking the model available", async () => {
    const badManifest: readonly LocalAIModelManifestEntry[] = [
      {
        ...TEST_MANIFEST[0],
        files: [{ path: "model.bin", sizeBytes: 5, sha1: "0000000000000000000000000000000000000000" }],
      },
    ];
    const { deps } = createDeps();
    const service = createLocalAIModelService(deps, badManifest);

    const models = await service.downloadModel("integrated-local-ai");

    expect(models[0].state.status).toBe("error");
    expect(models[0].state.lastError).toContain("Checksum failed");
  });

  it("resumes a partial download with a range request", async () => {
    const { deps, requests } = createDeps({
      responses: [TEXT.encode("llo")],
      seedFiles: {
        [modelPath("model.bin.partial")]: "he",
      },
    });
    const service = createLocalAIModelService(deps, TEST_MANIFEST);

    const models = await service.downloadModel("integrated-local-ai");

    expect(requests[0].range).toBe("bytes=2-");
    expect(models[0].state.status).toBe("available");
  });

  it("pauses an active download", async () => {
    let wroteFirstChunk!: () => void;
    const firstChunk = new Promise<void>((resolve) => { wroteFirstChunk = resolve; });
    const { deps } = createDeps();
    const originalOpen = deps.open;
    deps.open = async (path, openOptions) => {
      const handle = await originalOpen(path, openOptions);
      let resolved = false;
      return {
        async write(data) {
          const written = await handle.write(data);
          if (!resolved) {
            resolved = true;
            wroteFirstChunk();
          }
          return written;
        },
        async close() {
          await handle.close();
        },
      };
    };
    deps.fetch = async (_url, init) => {
      const signal = init?.signal as AbortSignal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(TEXT.encode("he"));
            signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
          },
        }),
      );
    };
    const service = createLocalAIModelService(deps, TEST_MANIFEST);

    const pending = service.downloadModel("integrated-local-ai");
    await firstChunk;
    await service.pauseDownload("integrated-local-ai");
    const paused = await pending;

    expect(paused[0].state.status).toBe("paused");
    expect(paused[0].state.downloadedBytes).toBe(2);
  });

  it("removes downloaded model files and resets state", async () => {
    const { deps, files } = createDeps();
    const service = createLocalAIModelService(deps, TEST_MANIFEST);

    await service.downloadModel("integrated-local-ai");
    const models = await service.removeModel("integrated-local-ai");

    expect(models[0].state.status).toBe("not_downloaded");
    expect(files.has(modelPath("model.bin"))).toBe(false);
  });

  it("does not add vectors or local model state to Automerge", () => {
    const doc = createEmptyDoc();
    const plain = A.toJS(doc) as unknown as Record<string, unknown>;
    const serialized = JSON.stringify(plain);

    expect(serialized).not.toContain("embedding");
    expect(serialized).not.toContain("vector");
    expect(serialized).not.toContain("localAI");
    expect((plain.preferences as Record<string, unknown>).ai).toEqual({
      provider: "none",
      model: "",
      autoSummarize: false,
      extractTopics: false,
    });
  });
});

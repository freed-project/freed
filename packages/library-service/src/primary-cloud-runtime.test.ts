import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryServicePrimaryCloudPortV1 } from "./primary-cloud-runtime.js";

const hooks = vi.hoisted(() => ({
  publication: null as null | {
    refreshInbound(input: unknown): Promise<void>;
  },
}));

vi.mock("./google-drive-publication.js", () => ({
  createBoundGoogleDrivePublicationStatePortV1: vi.fn(),
  createLibraryServiceGoogleDrivePublicationV1(
    options: typeof hooks.publication,
  ) {
    hooks.publication = options;
    return {};
  },
}));
vi.mock("./node-google-drive-token.js", () => ({
  createNodeGoogleDriveTokenPortV1: vi.fn(),
}));
vi.mock("./primary-runtime.js", () => ({
  createLibraryServicePrimaryRuntimeV1: () => ({
    start: async () => undefined,
  }),
}));

import { createNodeLibraryServicePrimaryCloudPortV1 } from "./primary-cloud-runtime.js";

afterEach(() => vi.unstubAllGlobals());

describe("installed Primary cloud composition", () => {
  it("constructs the default Drive transport without a supplied transport object", async () => {
    const descriptor = {
      authorityEpoch: "b".repeat(64),
      causalFrontierDigest: "d".repeat(64),
      format: "freed_normalized_checkpoint_export_v2",
      itemCount: 0,
      libraryId: "a".repeat(64),
      protocolVersion: 2,
      recordCount: 0,
      sourceRevision: 7,
      writerId: "c".repeat(64),
    };
    const signal = new AbortController().signal;
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBe(signal);
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetcher);
    const execute = vi.fn(async () => descriptor);
    await createNodeLibraryServicePrimaryCloudPortV1().start({
      config: {
        credentialRecordId: "synthetic-record",
        installationWitness: "e".repeat(64),
      },
      clock: { nowMs: () => 1_000 },
      native: { execute },
      stateFile: {},
      fileSystem: {},
    } as unknown as Parameters<LibraryServicePrimaryCloudPortV1["start"]>[0]);

    // Publication authority is covered by its own suite. Exercise the real
    // composition's admitted callback without vault access or live HTTP.
    expect(hooks.publication?.refreshInbound).toBeTypeOf("function");
    await hooks.publication!.refreshInbound({
      accessToken: "synthetic-token",
      controlFileId: "control-1",
      descriptor,
      signal,
    });
    expect(execute).toHaveBeenCalledWith("describe_checkpoint_export_v2", {});
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

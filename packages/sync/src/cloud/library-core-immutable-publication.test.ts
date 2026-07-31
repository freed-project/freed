import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLibraryCoreImmutableObjectKey,
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreControlPointerV1,
  type LibraryCoreImmutableObjectDescriptorV1,
} from "@freed/shared/library-core";
import {
  publishLibraryCoreImmutableGenerationV1,
  reassignLibraryCoreWriterV1,
  type LibraryCoreControlReadV1,
  type LibraryCoreImmutablePublicationAdapterV1,
  type LibraryCorePublishedImmutableObjectReceiptV1,
} from "./library-core-immutable-publication.js";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function operationObject(
  sequence: number,
  value = `operation-${sequence}`,
  epochId = "epoch-1",
): {
  descriptor: LibraryCoreImmutableObjectDescriptorV1;
  source: Uint8Array;
} {
  const source = bytes(value);
  const contentDigest = digest(source);
  return {
    descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
      objectKey: createLibraryCoreImmutableObjectKey({
        kind: "operation_segment",
        libraryId: "library-1",
        epochId,
        firstSequence: sequence,
        lastSequence: sequence,
        digest: contentDigest,
      }),
      contentDigest,
      byteLength: source.byteLength,
    }),
    source,
  };
}

function epochCertificateObject(
  epochId: string,
  value = `epoch-certificate-${epochId}`,
): ReturnType<typeof operationObject> {
  const source = bytes(value);
  const contentDigest = digest(source);
  return {
    descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
      objectKey: createLibraryCoreImmutableObjectKey({
        kind: "epoch_certificate",
        libraryId: "library-1",
        epochId,
        digest: contentDigest,
      }),
      contentDigest,
      byteLength: source.byteLength,
    }),
    source,
  };
}

function preparedManifest(
  generation: number,
  dependencies: readonly LibraryCorePublishedImmutableObjectReceiptV1[],
  epochId = "epoch-1",
  writerId = "desktop-1",
): {
  manifest: {
    descriptor: LibraryCoreImmutableObjectDescriptorV1;
    source: Uint8Array;
  };
  prepareControlPointer: (
    manifest: LibraryCorePublishedImmutableObjectReceiptV1,
  ) => LibraryCoreControlPointerV1;
} {
  const source = bytes(
    JSON.stringify(
      dependencies.map(({ descriptor, transportObjectId }) => ({
        contentDigest: descriptor.contentDigest,
        objectKey: descriptor.objectKey,
        transportObjectId,
      })),
    ),
  );
  const contentDigest = digest(source);
  const descriptor = parseLibraryCoreImmutableObjectDescriptorV1({
    objectKey: createLibraryCoreImmutableObjectKey({
      kind: "checkpoint_manifest",
      libraryId: "library-1",
      epochId,
      generation,
      digest: contentDigest,
    }),
    contentDigest,
    byteLength: source.byteLength,
  });
  return {
    manifest: { descriptor, source },
    prepareControlPointer(manifest) {
      return parseLibraryCoreControlPointerV1({
        schemaVersion: 1,
        protocolVersion: 1,
        libraryId: "library-1",
        storageEpoch: epochId,
        writerId,
        activeTransport: "google_drive_app_data_v1",
        generation,
        causalFrontierDigest: "fe".repeat(32),
        manifest: {
          descriptor: manifest.descriptor,
          transportObjectId: manifest.transportObjectId,
        },
      });
    },
  };
}

class FakeImmutableAdapter implements LibraryCoreImmutablePublicationAdapterV1<Uint8Array> {
  readonly events: string[] = [];
  readonly objects = new Map<
    string,
    {
      descriptor: LibraryCoreImmutableObjectDescriptorV1;
      bytes: Uint8Array;
    }
  >();
  control: LibraryCoreControlReadV1 = { revision: null, bytes: null };
  nextRevision = 1;
  failPutForKey: string | null = null;
  corruptVerificationForKey: string | null = null;
  forceCompareAndSwapConflict = false;
  loseCompareAndSwapResponse = false;

  async readControl(): Promise<LibraryCoreControlReadV1> {
    this.events.push("read-control");
    return {
      revision: this.control.revision,
      bytes: this.control.bytes?.slice() ?? null,
    };
  }

  async putImmutable({
    descriptor,
    source,
  }: {
    descriptor: LibraryCoreImmutableObjectDescriptorV1;
    source: Uint8Array;
  }): Promise<{ transportObjectId: string }> {
    this.events.push(`put:${descriptor.objectKey}`);
    if (descriptor.objectKey === this.failPutForKey) {
      throw new Error("injected upload interruption");
    }
    const transportObjectId = `object-${this.objects.size + 1}`;
    this.objects.set(transportObjectId, {
      descriptor,
      bytes: source.slice(),
    });
    return { transportObjectId };
  }

  async verifyImmutable(
    receipt: LibraryCorePublishedImmutableObjectReceiptV1,
  ): Promise<LibraryCoreImmutableObjectDescriptorV1> {
    this.events.push(`verify:${receipt.descriptor.objectKey}`);
    const stored = this.objects.get(receipt.transportObjectId);
    if (stored === undefined) throw new Error("object is missing");
    if (receipt.descriptor.objectKey === this.corruptVerificationForKey) {
      return {
        ...stored.descriptor,
        byteLength: stored.descriptor.byteLength + 1,
      };
    }
    return {
      objectKey: stored.descriptor.objectKey,
      contentDigest: digest(
        stored.bytes,
      ) as LibraryCoreImmutableObjectDescriptorV1["contentDigest"],
      byteLength: stored.bytes.byteLength,
    };
  }

  async compareAndSwapControl({
    expectedRevision,
    bytes: nextBytes,
  }: {
    expectedRevision: string | null;
    bytes: Uint8Array;
  }) {
    this.events.push("compare-and-swap-control");
    if (
      this.forceCompareAndSwapConflict ||
      this.control.revision !== expectedRevision
    ) {
      return {
        status: "conflict" as const,
        current: await this.readControl(),
      };
    }
    const revision = `revision-${this.nextRevision}`;
    this.nextRevision += 1;
    this.control = { revision, bytes: nextBytes.slice() };
    if (this.loseCompareAndSwapResponse) {
      this.loseCompareAndSwapResponse = false;
      throw new Error("injected response loss");
    }
    return { status: "committed" as const, revision };
  }
}

async function publish(
  adapter: FakeImmutableAdapter,
  input: {
    expectedControl: {
      revision: string | null;
      pointer: LibraryCoreControlPointerV1 | null;
    };
    generation: number;
    dependencies?: readonly ReturnType<typeof operationObject>[];
    onPrepareManifest?: () => void;
  },
) {
  return publishLibraryCoreImmutableGenerationV1({
    adapter,
    expectedControl: input.expectedControl,
    dependencies: input.dependencies ?? [operationObject(1)],
    prepareManifest(dependencies) {
      input.onPrepareManifest?.();
      return preparedManifest(input.generation, dependencies);
    },
  });
}

async function reassign(
  adapter: FakeImmutableAdapter,
  current: {
    revision: string;
    controlPointer: LibraryCoreControlPointerV1;
  },
  options: {
    targetStorageEpoch?: string;
    targetWriterId?: string;
    onPrepareManifest?: () => void;
  } = {},
) {
  const targetStorageEpoch = options.targetStorageEpoch ?? "epoch-2";
  const targetWriterId = options.targetWriterId ?? "desktop-2";
  return reassignLibraryCoreWriterV1({
    adapter,
    expectedControl: {
      revision: current.revision,
      pointer: current.controlPointer,
    },
    targetStorageEpoch,
    targetWriterId,
    epochCertificate: epochCertificateObject(targetStorageEpoch),
    dependencies: [operationObject(1, "epoch-transition", targetStorageEpoch)],
    prepareManifest(dependencies) {
      options.onPrepareManifest?.();
      return preparedManifest(
        0,
        dependencies,
        targetStorageEpoch,
        targetWriterId,
      );
    },
  });
}

describe("Library Core immutable publication", () => {
  it("verifies dependencies before building and publishing the manifest, then commits control", async () => {
    const adapter = new FakeImmutableAdapter();
    const dependency1 = operationObject(1);
    const dependency2 = operationObject(2);

    const result = await publish(adapter, {
      expectedControl: { revision: null, pointer: null },
      generation: 0,
      dependencies: [dependency1, dependency2],
      onPrepareManifest() {
        adapter.events.push("prepare-manifest");
      },
    });

    expect(result.status).toBe("committed");
    expect(adapter.events).toEqual([
      "read-control",
      `put:${dependency1.descriptor.objectKey}`,
      `verify:${dependency1.descriptor.objectKey}`,
      `put:${dependency2.descriptor.objectKey}`,
      `verify:${dependency2.descriptor.objectKey}`,
      "prepare-manifest",
      expect.stringMatching(/^put:freed-v2-manifest~library-1~eepoch-1~g0~/),
      expect.stringMatching(/^verify:freed-v2-manifest~library-1~eepoch-1~g0~/),
      "compare-and-swap-control",
    ]);
    expect(adapter.control.revision).toBe("revision-1");
    if (result.status !== "committed") throw new Error("setup failed");
    expect(result.manifest.transportObjectId).toBe("object-3");
    expect(result.controlPointer.manifest).toEqual({
      descriptor: result.manifest.descriptor,
      transportObjectId: "object-3",
    });
    if (adapter.control.bytes === null) throw new Error("missing control bytes");
    expect(
      parseLibraryCoreControlPointerV1(
        JSON.parse(new TextDecoder().decode(adapter.control.bytes)),
      ).manifest.transportObjectId,
    ).toBe("object-3");
  });

  it("stops before manifest preparation on an interrupted dependency upload", async () => {
    const adapter = new FakeImmutableAdapter();
    const dependency = operationObject(1);
    adapter.failPutForKey = dependency.descriptor.objectKey;
    let prepared = false;

    await expect(
      publish(adapter, {
        expectedControl: { revision: null, pointer: null },
        generation: 0,
        dependencies: [dependency],
        onPrepareManifest() {
          prepared = true;
        },
      }),
    ).rejects.toThrow(/upload interruption/);

    expect(prepared).toBe(false);
    expect(adapter.events).not.toContain("compare-and-swap-control");
  });

  it("stops before manifest publication when remote verification differs", async () => {
    const adapter = new FakeImmutableAdapter();
    const dependency = operationObject(1);
    adapter.corruptVerificationForKey = dependency.descriptor.objectKey;

    await expect(
      publish(adapter, {
        expectedControl: { revision: null, pointer: null },
        generation: 0,
        dependencies: [dependency],
      }),
    ).rejects.toThrow(/verification failed/);

    expect(
      adapter.events.some((event) =>
        event.startsWith("put:freed-v2-manifest~"),
      ),
    ).toBe(false);
    expect(adapter.events).not.toContain("compare-and-swap-control");
  });

  it("returns a preflight conflict without uploading from a stale control tuple", async () => {
    const adapter = new FakeImmutableAdapter();
    const first = await publish(adapter, {
      expectedControl: { revision: null, pointer: null },
      generation: 0,
    });
    expect(first.status).toBe("committed");
    const eventCount = adapter.events.length;

    const stale = await publish(adapter, {
      expectedControl: { revision: null, pointer: null },
      generation: 0,
    });

    expect(stale).toMatchObject({
      status: "conflict",
      currentRevision: "revision-1",
    });
    expect(adapter.events.slice(eventCount)).toEqual(["read-control"]);
  });

  it("returns the exact current tuple when the final compare-and-swap loses", async () => {
    const adapter = new FakeImmutableAdapter();
    const first = await publish(adapter, {
      expectedControl: { revision: null, pointer: null },
      generation: 0,
    });
    if (first.status !== "committed") throw new Error("setup failed");
    adapter.forceCompareAndSwapConflict = true;

    const result = await publish(adapter, {
      expectedControl: {
        revision: first.revision,
        pointer: first.controlPointer,
      },
      generation: 1,
      dependencies: [operationObject(2)],
    });

    expect(result).toMatchObject({
      status: "conflict",
      currentRevision: first.revision,
      currentControlPointer: first.controlPointer,
    });
  });

  it("recovers an exact committed pointer after the compare-and-swap response is lost", async () => {
    const adapter = new FakeImmutableAdapter();
    adapter.loseCompareAndSwapResponse = true;

    const result = await publish(adapter, {
      expectedControl: { revision: null, pointer: null },
      generation: 0,
    });

    expect(result).toMatchObject({
      status: "recovered_after_response_loss",
      revision: "revision-1",
    });
    expect(adapter.events.slice(-2)).toEqual([
      "compare-and-swap-control",
      "read-control",
    ]);
    if (result.status !== "recovered_after_response_loss") {
      throw new Error("setup failed");
    }
    expect(result.controlPointer.manifest.transportObjectId).toBe("object-2");
  });

  it("rejects a control pointer that substitutes another manifest transport object ID", async () => {
    const adapter = new FakeImmutableAdapter();

    await expect(
      publishLibraryCoreImmutableGenerationV1({
        adapter,
        expectedControl: { revision: null, pointer: null },
        dependencies: [operationObject(1)],
        prepareManifest(dependencies) {
          const prepared = preparedManifest(0, dependencies);
          return {
            ...prepared,
            prepareControlPointer(manifest) {
              return parseLibraryCoreControlPointerV1({
                ...prepared.prepareControlPointer(manifest),
                manifest: {
                  descriptor: manifest.descriptor,
                  transportObjectId: "wrong-drive-file",
                },
              });
            },
          };
        },
      }),
    ).rejects.toThrow(/exact verified manifest receipt/);
    expect(adapter.control).toEqual({ revision: null, bytes: null });
  });

  it("reassigns authority only by committing generation zero of a new writer epoch", async () => {
    const adapter = new FakeImmutableAdapter();
    const first = await publish(adapter, {
      expectedControl: { revision: null, pointer: null },
      generation: 0,
    });
    if (first.status !== "committed") throw new Error("setup failed");

    const result = await reassign(adapter, first);

    expect(result).toMatchObject({
      status: "committed",
      revision: "revision-2",
      controlPointer: {
        libraryId: "library-1",
        storageEpoch: "epoch-2",
        writerId: "desktop-2",
        activeTransport: "google_drive_app_data_v1",
        generation: 0,
      },
    });
    expect(
      adapter.events.find((event) =>
        event.startsWith("put:freed-v2-epoch~library-1~epoch-2~"),
      ),
    ).toBeDefined();
    expect(adapter.events.at(-1)).toBe("compare-and-swap-control");
  });

  it("returns a stale writer reassignment conflict before staging objects", async () => {
    const adapter = new FakeImmutableAdapter();
    const first = await publish(adapter, {
      expectedControl: { revision: null, pointer: null },
      generation: 0,
    });
    if (first.status !== "committed") throw new Error("setup failed");
    const second = await publish(adapter, {
      expectedControl: {
        revision: first.revision,
        pointer: first.controlPointer,
      },
      generation: 1,
      dependencies: [operationObject(2)],
    });
    if (second.status !== "committed") throw new Error("setup failed");
    const eventCount = adapter.events.length;

    const result = await reassign(adapter, first);

    expect(result).toMatchObject({
      status: "conflict",
      currentRevision: second.revision,
      currentControlPointer: second.controlPointer,
    });
    expect(adapter.events.slice(eventCount)).toEqual(["read-control"]);
  });

  it("recovers writer reassignment after the exact control commit response is lost", async () => {
    const adapter = new FakeImmutableAdapter();
    const first = await publish(adapter, {
      expectedControl: { revision: null, pointer: null },
      generation: 0,
    });
    if (first.status !== "committed") throw new Error("setup failed");
    adapter.loseCompareAndSwapResponse = true;

    const result = await reassign(adapter, first);

    expect(result).toMatchObject({
      status: "recovered_after_response_loss",
      revision: "revision-2",
      controlPointer: {
        storageEpoch: "epoch-2",
        writerId: "desktop-2",
      },
    });
    expect(adapter.events.slice(-2)).toEqual([
      "compare-and-swap-control",
      "read-control",
    ]);
  });

  it("rejects same-epoch or same-writer targets before transport work", async () => {
    const adapter = new FakeImmutableAdapter();
    const first = await publish(adapter, {
      expectedControl: { revision: null, pointer: null },
      generation: 0,
    });
    if (first.status !== "committed") throw new Error("setup failed");
    const eventCount = adapter.events.length;

    await expect(
      reassign(adapter, first, { targetStorageEpoch: "epoch-1" }),
    ).rejects.toThrow(/new epoch and new writer/);
    await expect(
      reassign(adapter, first, { targetWriterId: "desktop-1" }),
    ).rejects.toThrow(/new epoch and new writer/);
    expect(adapter.events).toHaveLength(eventCount);
  });

  it("rejects an epoch certificate bound to another target before transport work", async () => {
    const adapter = new FakeImmutableAdapter();
    const first = await publish(adapter, {
      expectedControl: { revision: null, pointer: null },
      generation: 0,
    });
    if (first.status !== "committed") throw new Error("setup failed");
    const eventCount = adapter.events.length;

    await expect(
      reassignLibraryCoreWriterV1({
        adapter,
        expectedControl: {
          revision: first.revision,
          pointer: first.controlPointer,
        },
        targetStorageEpoch: "epoch-2",
        targetWriterId: "desktop-2",
        epochCertificate: epochCertificateObject("epoch-3"),
        dependencies: [],
        prepareManifest(dependencies) {
          return preparedManifest(0, dependencies, "epoch-2", "desktop-2");
        },
      }),
    ).rejects.toThrow(/certificate does not match/);
    expect(adapter.events).toHaveLength(eventCount);
  });

  it("never publishes authority after epoch-certificate verification fails", async () => {
    const adapter = new FakeImmutableAdapter();
    const first = await publish(adapter, {
      expectedControl: { revision: null, pointer: null },
      generation: 0,
    });
    if (first.status !== "committed") throw new Error("setup failed");
    const certificate = epochCertificateObject("epoch-2");
    adapter.corruptVerificationForKey = certificate.descriptor.objectKey;
    const eventCount = adapter.events.length;

    await expect(
      reassignLibraryCoreWriterV1({
        adapter,
        expectedControl: {
          revision: first.revision,
          pointer: first.controlPointer,
        },
        targetStorageEpoch: "epoch-2",
        targetWriterId: "desktop-2",
        epochCertificate: certificate,
        dependencies: [],
        prepareManifest(dependencies) {
          return preparedManifest(0, dependencies, "epoch-2", "desktop-2");
        },
      }),
    ).rejects.toThrow(/verification failed/);
    expect(adapter.events.slice(eventCount)).toEqual([
      "read-control",
      `put:${certificate.descriptor.objectKey}`,
      `verify:${certificate.descriptor.objectKey}`,
    ]);
    expect(adapter.control.revision).toBe(first.revision);
  });

  it("never transfers authority across an unverified causal frontier", async () => {
    const adapter = new FakeImmutableAdapter();
    const first = await publish(adapter, {
      expectedControl: { revision: null, pointer: null },
      generation: 0,
    });
    if (first.status !== "committed") throw new Error("setup failed");
    const certificate = epochCertificateObject("epoch-2");
    const eventCount = adapter.events.length;

    await expect(
      reassignLibraryCoreWriterV1({
        adapter,
        expectedControl: {
          revision: first.revision,
          pointer: first.controlPointer,
        },
        targetStorageEpoch: "epoch-2",
        targetWriterId: "desktop-2",
        epochCertificate: certificate,
        dependencies: [],
        prepareManifest(dependencies) {
          const prepared = preparedManifest(
            0,
            dependencies,
            "epoch-2",
            "desktop-2",
          );
          return {
            ...prepared,
            prepareControlPointer(manifest) {
              return parseLibraryCoreControlPointerV1({
                ...prepared.prepareControlPointer(manifest),
                causalFrontierDigest: "aa".repeat(32),
              });
            },
          };
        },
      }),
    ).rejects.toThrow(/exact causal frontier/);
    expect(adapter.events.slice(eventCount)).not.toContain(
      "compare-and-swap-control",
    );
    expect(adapter.control.revision).toBe(first.revision);
  });

  it("rejects oversized control bytes before uploading", async () => {
    const adapter = new FakeImmutableAdapter();
    adapter.control = {
      revision: "revision-oversized",
      bytes: new Uint8Array(65_537),
    };

    await expect(
      publish(adapter, {
        expectedControl: { revision: null, pointer: null },
        generation: 0,
      }),
    ).rejects.toThrow(/control bytes exceed 65,536 bytes/);
    expect(adapter.events).toEqual(["read-control"]);
  });

  it("does not let ordinary publication switch the active cloud transport", async () => {
    const adapter = new FakeImmutableAdapter();
    const first = await publish(adapter, {
      expectedControl: { revision: null, pointer: null },
      generation: 0,
    });
    if (first.status !== "committed") throw new Error("setup failed");

    await expect(
      publishLibraryCoreImmutableGenerationV1({
        adapter,
        expectedControl: {
          revision: first.revision,
          pointer: first.controlPointer,
        },
        dependencies: [operationObject(2)],
        prepareManifest(dependencies) {
          const prepared = preparedManifest(1, dependencies);
          return {
            ...prepared,
            prepareControlPointer(manifest) {
              return parseLibraryCoreControlPointerV1({
                ...prepared.prepareControlPointer(manifest),
                activeTransport: "dropbox_app_folder_v1",
              });
            },
          };
        },
      }),
    ).rejects.toThrow(/preserve library, writer epoch/);
    expect(adapter.control.revision).toBe(first.revision);
  });

  it.each([
    [
      "storage epoch",
      { pointerPatch: { storageEpoch: "epoch-2" }, epochId: "epoch-2" },
    ],
    ["writer", { pointerPatch: { writerId: "desktop-2" }, epochId: "epoch-1" }],
  ])(
    "does not let ordinary publication replace the active %s",
    async (_label, replacement) => {
      const adapter = new FakeImmutableAdapter();
      const first = await publish(adapter, {
        expectedControl: { revision: null, pointer: null },
        generation: 0,
      });
      if (first.status !== "committed") throw new Error("setup failed");

      await expect(
        publishLibraryCoreImmutableGenerationV1({
          adapter,
          expectedControl: {
            revision: first.revision,
            pointer: first.controlPointer,
          },
          dependencies: [operationObject(2)],
          prepareManifest(dependencies) {
            const prepared = preparedManifest(
              1,
              dependencies,
              replacement.epochId,
            );
            return {
              ...prepared,
              prepareControlPointer(manifest) {
                return parseLibraryCoreControlPointerV1({
                  ...prepared.prepareControlPointer(manifest),
                  ...replacement.pointerPatch,
                });
              },
            };
          },
        }),
      ).rejects.toThrow(/preserve library, writer epoch/);
      expect(adapter.control.revision).toBe(first.revision);
    },
  );

  it("rejects duplicate dependency locators before publishing a manifest", async () => {
    const adapter = new FakeImmutableAdapter();
    const dependency = operationObject(1);

    await expect(
      publish(adapter, {
        expectedControl: { revision: null, pointer: null },
        generation: 0,
        dependencies: [dependency, dependency],
      }),
    ).rejects.toThrow(/repeats object key/);
    expect(
      adapter.events.some((event) =>
        event.startsWith("put:freed-v2-manifest~"),
      ),
    ).toBe(false);
  });
});

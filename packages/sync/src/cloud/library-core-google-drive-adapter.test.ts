import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLibraryCoreControlObjectKey,
  createLibraryCoreImmutableObjectKey,
  createLibraryCoreIntentHeadObjectKey,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreIntentHeadV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectDescriptorV1,
} from "@freed/shared/library-core";
import {
  createGoogleDriveLibraryCoreAdapterV1,
  createGoogleDriveLibraryCoreIntentAdapterV1,
  discoverGoogleDriveLibraryCoreControlV1,
  discoverGoogleDriveLibraryCoreIntentHeadV1,
  discoverGoogleDriveLibraryCoreIntentSegmentsV1,
  discoverPublishedGoogleDriveLibraryCoreControlV1,
  provisionGoogleDriveLibraryCoreControlV1,
  provisionGoogleDriveLibraryCoreIntentHeadV1,
} from "./library-core-google-drive-adapter.js";

const encoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function keyDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function libraryDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function operationObject(value = "operation-1"): {
  readonly descriptor: LibraryCoreImmutableObjectDescriptorV1;
  readonly source: Uint8Array;
} {
  const source = bytes(value);
  const contentDigest = digest(source);
  return {
    descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
      objectKey: createLibraryCoreImmutableObjectKey({
        kind: "operation_segment",
        libraryId: "library-1",
        epochId: "epoch-1",
        firstSequence: 1,
        lastSequence: 1,
        digest: contentDigest,
      }),
      contentDigest,
      byteLength: source.byteLength,
    }),
    source,
  };
}

function emptyIntentHead() {
  return parseLibraryCoreIntentHeadV1({
    actor_id: "actor-1",
    epoch_id: "epoch-1",
    latest_segment: null,
    latest_segment_digest: null,
    library_id: "library-1",
    next_intent_sequence: 1,
    protocol: "intent_head_v1",
    protocol_version: 1,
    schema_version: 1,
  });
}

interface FakeDriveFile {
  readonly id: string;
  name: string;
  bytes: Uint8Array;
  readonly appProperties: Record<string, string>;
  etag: string;
}

class FakeGoogleDrive {
  readonly files = new Map<string, FakeDriveFile>();
  readonly requests: Array<{
    readonly url: string;
    readonly method: string;
    readonly headers: Headers;
  }> = [];
  uploadCount = 0;
  nextId = 1;
  uploadFixture: ReturnType<typeof operationObject> | null = null;
  intentHeadFixture: ReturnType<typeof emptyIntentHead> | null = null;

  addControl(
    id = "control-1",
    controlBytes = bytes('{"current":true}'),
    etag = '"control-revision-1"',
  ): FakeDriveFile {
    const file: FakeDriveFile = {
      id,
      name: createLibraryCoreControlObjectKey("library-1"),
      bytes: controlBytes.slice(),
      appProperties: {
        freedProtocol: "library-core-v1",
        freedLibraryDigest: libraryDigest("library-1"),
        freedObjectKind: "control",
      },
      etag,
    };
    this.files.set(id, file);
    return file;
  }

  addImmutable(
    fixture: ReturnType<typeof operationObject>,
    id = "immutable-1",
  ): FakeDriveFile {
    const file: FakeDriveFile = {
      id,
      name: fixture.descriptor.objectKey,
      bytes: fixture.source.slice(),
      appProperties: {
        freedProtocol: "library-core-v1",
        freedLibraryDigest: libraryDigest("library-1"),
        freedObjectKind: "operations",
        freedObjectKeyDigest: keyDigest(fixture.descriptor.objectKey),
        freedContentDigest: fixture.descriptor.contentDigest,
      },
      etag: `"immutable-${id}"`,
    };
    this.files.set(id, file);
    return file;
  }

  addIntentHead(
    head = emptyIntentHead(),
    id = "intent-head-1",
    etag = '"intent-head-revision-1"',
  ): FakeDriveFile {
    const file: FakeDriveFile = {
      id,
      name: createLibraryCoreIntentHeadObjectKey(
        head.library_id,
        head.actor_id,
      ),
      bytes: encodeLibraryCoreCanonicalValue(
        head as unknown as LibraryCoreCanonicalValue,
      ),
      appProperties: {
        freedProtocol: "library-core-v1",
        freedLibraryDigest: libraryDigest(head.library_id),
        freedObjectKind: "intent_head",
        freedActorDigest: libraryDigest(head.actor_id),
      },
      etag,
    };
    this.files.set(id, file);
    return file;
  }

  readonly fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    this.requests.push({ url, method, headers });
    const parsed = new URL(url);

    if (
      method === "GET" &&
      parsed.hostname === "www.googleapis.com" &&
      parsed.pathname === "/drive/v3/files"
    ) {
      const query = parsed.searchParams.get("q") ?? "";
      const properties = new Map<string, string>();
      for (const match of query.matchAll(
        /appProperties has \{ key='([^']+)' and value='([^']*)' \}/gu,
      )) {
        const [, key, value] = match;
        if (key !== undefined && value !== undefined) {
          properties.set(key, value);
        }
      }
      const matches = [...this.files.values()].filter((file) =>
        [...properties].every(
          ([key, value]) => file.appProperties[key] === value,
        ),
      );
      return Response.json({
        files: matches.map((file) => this.metadata(file)),
      });
    }

    const uploadMatch = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/u.exec(
      parsed.pathname,
    );
    if (uploadMatch !== null && method === "POST") {
      this.uploadCount += 1;
      const body = init.body;
      if (!(body instanceof Blob)) {
        return new Response("expected multipart Blob", { status: 400 });
      }
      const bodyText = new TextDecoder().decode(await body.arrayBuffer());
      if (bodyText.includes('"freedObjectKind":"intent_head"')) {
        const fixture = this.intentHeadFixture;
        if (fixture === null) {
          return new Response("missing fake intent-head fixture", { status: 500 });
        }
        const file = this.addIntentHead(
          fixture,
          `intent-head-${this.nextId}`,
          `"intent-head-revision-${this.nextId}"`,
        );
        this.nextId += 1;
        return Response.json(this.metadata(file));
      }
      if (bodyText.includes('"freedObjectKind":"control"')) {
        const file = this.addControl(
          `control-${this.nextId}`,
          bytes("{}"),
          `"control-revision-${this.nextId}"`,
        );
        this.nextId += 1;
        return Response.json(this.metadata(file));
      }
      const fixture = this.uploadFixture;
      if (fixture === null) {
        return new Response("missing fake upload fixture", { status: 500 });
      }
      if (
        !bodyText.includes(fixture.descriptor.objectKey) ||
        !bodyText.includes('"parents":["appDataFolder"]') ||
        !bodyText.includes('"freedObjectKind":"operations"') ||
        !bodyText.includes(new TextDecoder().decode(fixture.source))
      ) {
        return new Response("multipart body mismatch", { status: 400 });
      }
      const file = this.addImmutable(fixture, `uploaded-${this.nextId}`);
      this.nextId += 1;
      return Response.json(this.metadata(file));
    }

    if (
      uploadMatch !== null &&
      uploadMatch[1] !== undefined &&
      method === "PATCH"
    ) {
      const file = this.files.get(decodeURIComponent(uploadMatch[1]));
      if (file === undefined) return new Response("missing", { status: 404 });
      if (headers.get("If-Match") !== file.etag) {
        return new Response("precondition failed", { status: 412 });
      }
      const body = init.body;
      if (!(body instanceof ArrayBuffer)) {
        return new Response("expected control bytes", { status: 400 });
      }
      file.bytes = new Uint8Array(body).slice();
      file.etag = `"control-revision-updated-${this.nextId}"`;
      this.nextId += 1;
      return Response.json(this.metadata(file));
    }

    const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/u.exec(parsed.pathname);
    if (fileMatch !== null && method === "GET") {
      const file = this.files.get(decodeURIComponent(fileMatch[1] ?? ""));
      if (file === undefined) return new Response("missing", { status: 404 });
      if (parsed.searchParams.get("alt") === "media") {
        return new Response(file.bytes.slice(), {
          headers: {
            ETag: file.etag,
            "Content-Length": String(file.bytes.byteLength),
          },
        });
      }
      return Response.json(this.metadata(file));
    }

    return new Response(`unhandled ${method} ${url}`, { status: 500 });
  };

  private metadata(file: FakeDriveFile): Record<string, unknown> {
    return {
      id: file.id,
      name: file.name,
      size: String(file.bytes.byteLength),
      appProperties: file.appProperties,
    };
  }
}

function adapter(fake: FakeGoogleDrive) {
  return createGoogleDriveLibraryCoreAdapterV1({
    accessToken: "test-token",
    libraryId: "library-1",
    controlFileId: "control-1",
    googleFetch: fake.fetch,
  });
}

describe("Google Drive Library Core immutable adapter", () => {
  it("provisions one empty control and then reuses its exact file ID", async () => {
    const fake = new FakeGoogleDrive();

    await expect(
      provisionGoogleDriveLibraryCoreControlV1({
        accessToken: "test-token",
        libraryId: "library-1",
        googleFetch: fake.fetch,
      }),
    ).resolves.toEqual({ controlFileId: "control-1", created: true });
    await expect(
      provisionGoogleDriveLibraryCoreControlV1({
        accessToken: "test-token",
        libraryId: "library-1",
        googleFetch: fake.fetch,
      }),
    ).resolves.toEqual({ controlFileId: "control-1", created: false });
    expect(fake.uploadCount).toBe(1);
  });

  it("discovers one control by private properties rather than filename query", async () => {
    const fake = new FakeGoogleDrive();
    const control = fake.addControl();
    control.name = "renamed-by-user";

    await expect(
      discoverGoogleDriveLibraryCoreControlV1({
        accessToken: "test-token",
        libraryId: "library-1",
        googleFetch: fake.fetch,
      }),
    ).resolves.toEqual({ controlFileId: "control-1" });

    const query = new URL(fake.requests[0]?.url ?? "").searchParams.get("q");
    expect(query).toContain("freedObjectKind");
    expect(query).toContain("freedLibraryDigest");
    expect(query).not.toContain("name =");
  });

  it("discovers a fresh PWA library identity from the sole published control", async () => {
    const fake = new FakeGoogleDrive();
    const manifestDigest = "22".repeat(32);
    fake.addControl(
      "control-1",
      bytes(
        JSON.stringify({
          activeTransport: "google_drive_app_data_v1",
          causalFrontierDigest: "11".repeat(32),
          generation: 1,
          libraryId: "library-1",
          manifest: {
            descriptor: {
              byteLength: 10,
              contentDigest: manifestDigest,
              objectKey: createLibraryCoreImmutableObjectKey({
                kind: "checkpoint_manifest",
                libraryId: "library-1",
                epochId: "epoch-1",
                generation: 1,
                digest: manifestDigest,
              }),
            },
            transportObjectId: "manifest-1",
          },
          protocolVersion: 1,
          schemaVersion: 1,
          storageEpoch: "epoch-1",
          writerId: "desktop-1",
        }),
      ),
    );

    const discovered = await discoverPublishedGoogleDriveLibraryCoreControlV1({
      accessToken: "test-token",
      googleFetch: fake.fetch,
    });

    expect(discovered).toMatchObject({
      controlFileId: "control-1",
      libraryId: "library-1",
      control: { revision: '"control-revision-1"' },
    });
    expect(discovered?.control.bytes.byteLength).toBeGreaterThan(0);
    const query = new URL(fake.requests[0]?.url ?? "").searchParams.get("q");
    expect(query).toContain("freedObjectKind");
    expect(query).not.toContain("freedLibraryDigest");
  });

  it("fails closed when private properties identify duplicate controls", async () => {
    const fake = new FakeGoogleDrive();
    fake.addControl("control-1");
    fake.addControl("control-2");

    await expect(
      discoverGoogleDriveLibraryCoreControlV1({
        accessToken: "test-token",
        libraryId: "library-1",
        googleFetch: fake.fetch,
      }),
    ).rejects.toThrow("more than 1 match");
  });

  it("returns null when the library has no provisioned control", async () => {
    const fake = new FakeGoogleDrive();
    await expect(
      discoverGoogleDriveLibraryCoreControlV1({
        accessToken: "test-token",
        libraryId: "library-1",
        googleFetch: fake.fetch,
      }),
    ).resolves.toBeNull();
  });

  it("uploads one bounded immutable object and verifies exact stored bytes", async () => {
    const fake = new FakeGoogleDrive();
    fake.addControl();
    const fixture = operationObject();
    fake.uploadFixture = fixture;

    const stored = await adapter(fake).putImmutable(fixture);

    expect(stored).toEqual({ transportObjectId: "uploaded-1" });
    expect(fake.uploadCount).toBe(1);
    await expect(
      adapter(fake).verifyImmutable({
        descriptor: fixture.descriptor,
        transportObjectId: stored.transportObjectId,
      }),
    ).resolves.toEqual(fixture.descriptor);
    await expect(
      adapter(fake).readImmutable({
        descriptor: fixture.descriptor,
        transportObjectId: stored.transportObjectId,
      }),
    ).resolves.toEqual(fixture.source);
    const upload = fake.requests.find((request) => request.method === "POST");
    expect(upload?.headers.get("Content-Type")).toContain("multipart/related");
  });

  it("collapses an exact immutable retry without another upload", async () => {
    const fake = new FakeGoogleDrive();
    fake.addControl();
    const fixture = operationObject();
    fake.addImmutable(fixture, "existing-2");
    fake.addImmutable(fixture, "existing-1");
    fake.uploadFixture = fixture;

    await expect(adapter(fake).putImmutable(fixture)).resolves.toEqual({
      transportObjectId: "existing-1",
    });
    expect(fake.uploadCount).toBe(0);
  });

  it("rejects all duplicate candidates when any identity match is corrupt", async () => {
    const fake = new FakeGoogleDrive();
    fake.addControl();
    const fixture = operationObject();
    fake.addImmutable(fixture, "valid");
    const corrupt = fake.addImmutable(fixture, "corrupt");
    corrupt.bytes = bytes("changed");

    await expect(adapter(fake).putImmutable(fixture)).rejects.toThrow(
      /metadata mismatch|byte length mismatch|digest mismatch/u,
    );
    expect(fake.uploadCount).toBe(0);
  });

  it("does not treat a renamed immutable file as a different authority object", async () => {
    const fake = new FakeGoogleDrive();
    fake.addControl();
    const fixture = operationObject();
    const stored = fake.addImmutable(fixture, "renamed-object");
    Object.assign(stored, { name: "descriptive-name-changed-by-user" });

    await expect(adapter(fake).putImmutable(fixture)).resolves.toEqual({
      transportObjectId: "renamed-object",
    });
    expect(fake.uploadCount).toBe(0);
  });

  it("rejects changed bytes under one immutable identity", async () => {
    const fake = new FakeGoogleDrive();
    fake.addControl();
    const fixture = operationObject();
    const stored = fake.addImmutable(fixture);
    stored.bytes = bytes("changed");

    await expect(adapter(fake).putImmutable(fixture)).rejects.toThrow(
      /metadata mismatch|byte length mismatch|digest mismatch/u,
    );
    expect(fake.uploadCount).toBe(0);
  });

  it("rejects a malformed local object before any Drive upload", async () => {
    const fake = new FakeGoogleDrive();
    fake.addControl();
    const fixture = operationObject();

    await expect(
      adapter(fake).putImmutable({
        descriptor: fixture.descriptor,
        source: bytes("wrong"),
      }),
    ).rejects.toThrow(/byte length|digest/u);
    expect(fake.uploadCount).toBe(0);
  });

  it("rejects a locator from a different hyphenated library exactly", async () => {
    const fake = new FakeGoogleDrive();
    fake.addControl();
    const source = bytes("foreign");
    const contentDigest = digest(source);
    const descriptor = parseLibraryCoreImmutableObjectDescriptorV1({
      objectKey: createLibraryCoreImmutableObjectKey({
        kind: "operation_segment",
        libraryId: "library-1-other",
        epochId: "epoch-1",
        firstSequence: 1,
        lastSequence: 1,
        digest: contentDigest,
      }),
      contentDigest,
      byteLength: source.byteLength,
    });

    await expect(
      adapter(fake).putImmutable({ descriptor, source }),
    ).rejects.toThrow("does not belong to this library");
    expect(fake.requests).toHaveLength(0);
  });

  it("updates control only with the exact ETag and verifies readback", async () => {
    const fake = new FakeGoogleDrive();
    fake.addControl();
    const nextControl = bytes('{"next":true}');

    const result = await adapter(fake).compareAndSwapControl({
      expectedRevision: '"control-revision-1"',
      bytes: nextControl,
    });

    expect(result).toEqual({
      status: "committed",
      revision: '"control-revision-updated-1"',
    });
    const patch = fake.requests.find((request) => request.method === "PATCH");
    expect(patch?.headers.get("If-Match")).toBe('"control-revision-1"');
    expect(fake.files.get("control-1")?.bytes).toEqual(nextControl);
  });

  it("returns the exact current control after a precondition race", async () => {
    const fake = new FakeGoogleDrive();
    fake.addControl("control-1", bytes('{"winner":true}'), '"winner-revision"');

    await expect(
      adapter(fake).compareAndSwapControl({
        expectedRevision: '"stale-revision"',
        bytes: bytes('{"loser":true}'),
      }),
    ).resolves.toEqual({
      status: "conflict",
      current: {
        revision: '"winner-revision"',
        bytes: bytes('{"winner":true}'),
      },
    });
  });

  it("rejects null expected revisions because bootstrap is separate", async () => {
    const fake = new FakeGoogleDrive();
    fake.addControl();

    await expect(
      adapter(fake).compareAndSwapControl({
        expectedRevision: null,
        bytes: bytes('{"next":true}'),
      }),
    ).rejects.toThrow("expected Drive control revision");
    expect(fake.requests).toHaveLength(0);
  });

  it("provisions and advances one actor intent head with exact ETag admission", async () => {
    const fake = new FakeGoogleDrive();
    fake.addControl();
    const head = emptyIntentHead();
    fake.intentHeadFixture = head;

    await expect(
      provisionGoogleDriveLibraryCoreIntentHeadV1({
        accessToken: "test-token",
        googleFetch: fake.fetch,
        head,
      }),
    ).resolves.toEqual({ intentHeadFileId: "intent-head-1", created: true });
    await expect(
      discoverGoogleDriveLibraryCoreIntentHeadV1({
        accessToken: "test-token",
        actorId: head.actor_id,
        googleFetch: fake.fetch,
        libraryId: head.library_id,
      }),
    ).resolves.toEqual({ intentHeadFileId: "intent-head-1" });

    const intentAdapter = createGoogleDriveLibraryCoreIntentAdapterV1({
      accessToken: "test-token",
      actorId: head.actor_id,
      controlFileId: "control-1",
      googleFetch: fake.fetch,
      intentHeadFileId: "intent-head-1",
      libraryId: head.library_id,
    });
    const initial = await intentAdapter.readIntentHead();
    await expect(
      intentAdapter.compareAndSwapIntentHead({
        bytes: encodeLibraryCoreCanonicalValue(
          head as unknown as LibraryCoreCanonicalValue,
        ),
        expectedRevision: initial.revision,
      }),
    ).resolves.toEqual({ status: "committed" });
    await expect(
      intentAdapter.compareAndSwapIntentHead({
        bytes: encodeLibraryCoreCanonicalValue(
          head as unknown as LibraryCoreCanonicalValue,
        ),
        expectedRevision: initial.revision,
      }),
    ).resolves.toMatchObject({
      status: "conflict",
      current: { head },
    });
  });

  it("discovers one actor's immutable intent segments in sequence order", async () => {
    const fake = new FakeGoogleDrive();
    for (const [first, last, id] of [[3, 4, "segment-2"], [1, 2, "segment-1"]] as const) {
      const source = bytes(`intent-${first.toLocaleString("en-US", { useGrouping: false })}`);
      const contentDigest = digest(source);
      const objectKey = createLibraryCoreImmutableObjectKey({
        actorId: "actor-1",
        digest: contentDigest,
        firstSequence: first,
        kind: "intent_segment",
        lastSequence: last,
        libraryId: "library-1",
      });
      fake.files.set(id, {
        appProperties: {
          freedContentDigest: contentDigest,
          freedLibraryDigest: libraryDigest("library-1"),
          freedObjectKeyDigest: keyDigest(objectKey),
          freedObjectKind: "intents",
          freedProtocol: "library-core-v1",
        },
        bytes: source,
        etag: `"${id}"`,
        id,
        name: objectKey,
      });
    }

    await expect(
      discoverGoogleDriveLibraryCoreIntentSegmentsV1({
        accessToken: "test-token",
        actorId: "actor-1",
        googleFetch: fake.fetch,
        libraryId: "library-1",
      }),
    ).resolves.toMatchObject([
      { firstIntentSequence: 1, lastIntentSequence: 2 },
      { firstIntentSequence: 3, lastIntentSequence: 4 },
    ]);
  });

  it("rejects an oversized control response before reading its body", async () => {
    const fake = new FakeGoogleDrive();
    fake.addControl();
    const oversizedFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("control-1?alt=media")) {
        return new Response("small", {
          headers: {
            ETag: '"control-revision-1"',
            "Content-Length": "65537",
          },
        });
      }
      return fake.fetch(input, init);
    };
    const boundedAdapter = createGoogleDriveLibraryCoreAdapterV1({
      accessToken: "test-token",
      libraryId: "library-1",
      controlFileId: "control-1",
      googleFetch: oversizedFetch,
    });

    await expect(boundedAdapter.readControl()).rejects.toThrow(
      "exceeds 65,536 bytes",
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  createLibraryCoreImmutableObjectKey,
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import { createGoogleDrivePrimaryTransportV2 } from "./google-drive-primary-transport.js";

const libraryId = "a".repeat(64) as LibraryCoreLowercaseHex64;
const epochId = "b".repeat(64) as LibraryCoreLowercaseHex64;
const actorId = "c".repeat(64) as LibraryCoreLowercaseHex64;

describe("headless normalized Drive transport", () => {
  it("pages real nonempty discovery beyond sixteen actors and excludes completed enrollments", async () => {
    const hash = (value: string | Uint8Array) =>
      createHash("sha256").update(value).digest("hex");
    const files: {
      id: string;
      name: string;
      size: string;
      bytes: Uint8Array;
      appProperties: Record<string, string>;
    }[] = [];
    const actors = Array.from(
      { length: 18 },
      (_, index) =>
        (index + 1).toString(16).padStart(64, "0") as LibraryCoreLowercaseHex64,
    );
    for (const [index, actor] of actors.entries()) {
      const requestDigest = hash(`request-body-${index}`);
      for (const certificate of [false, true]) {
        if (certificate && index === 17) continue;
        // Discovery identities are deliberately not native signature fixtures.
        const identity = {
          actor_id: actor,
          library_id: libraryId,
          epoch_id: epochId,
        };
        const body = {
          actor_enrollment_body: identity,
          enrollment_body_digest: requestDigest,
          actor_proof: "d".repeat(128),
          actor_capability_body: {},
          actor_capability_body_digest: "e".repeat(64),
        };
        const bytes = encodeLibraryCoreCanonicalValue({
          certificate_body: body,
          certificate_digest: hash(`certificate-${index}`),
          ...(certificate ? { authority_signature: "f".repeat(128) } : {}),
        });
        const digest = hash(bytes);
        const name = createLibraryCoreImmutableObjectKey({
          kind: certificate ? "actor_enrollment" : "actor_enrollment_request",
          actorId: actor,
          libraryId,
          epochId,
          digest,
        });
        files.push({
          id: `object-${index}-${certificate}`,
          name,
          size: String(bytes.byteLength),
          bytes,
          appProperties: {
            freedProtocol: "library-core-v1",
            freedLibraryDigest: hash(libraryId),
            freedObjectKind: certificate ? "enrollment" : "enrollment_request",
            freedObjectKeyDigest: hash(name),
            freedContentDigest: digest,
          },
        });
      }
    }
    const googleFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method ?? "GET").toBe("GET");
        const url = new URL(String(input));
        if (url.searchParams.get("alt") === "media") {
          const file = files.find((value) =>
            url.pathname.endsWith(`/${value.id}`),
          );
          if (!file) throw new Error("unknown immutable fixture");
          return new Response(file.bytes.slice().buffer, { status: 200 });
        }
        const kind = url.searchParams.get("q")?.includes("enrollment_request")
          ? "enrollment_request"
          : "enrollment";
        return new Response(
          JSON.stringify({
            files: files
              .filter((file) => file.appProperties.freedObjectKind === kind)
              .map(({ bytes: _bytes, ...file }) => file),
          }),
          { status: 200 },
        );
      },
    );
    const transport = createGoogleDrivePrimaryTransportV2({
      accessToken: "synthetic-token",
      controlFileId: "control-1",
      libraryId,
      epochId,
      signal: new AbortController().signal,
      googleFetch,
    });
    const pending = await transport.pageEnrollmentRequests({
      libraryId,
      storageEpochId: epochId,
      limit: 16,
    });
    expect(pending.done).toBe(true);
    expect(
      pending.requests.map((value) => value.reference.transportObjectId),
    ).toEqual(["object-17-false"]);
    const first = await transport.pageActors({
      libraryId,
      storageEpochId: epochId,
      afterActorId: null,
      limit: 16,
    });
    expect(first).toEqual({
      actorIds: actors.slice(0, 16),
      done: false,
      nextActorId: actors[15],
    });
    const next = await transport.pageActors({
      libraryId,
      storageEpochId: epochId,
      afterActorId: first.nextActorId,
      limit: 16,
    });
    expect(next).toEqual({
      actorIds: [actors[16]],
      done: true,
      nextActorId: actors[16],
    });
  });
  it("uses real bounded discovery with the refresh signal and no empty-library writes", async () => {
    const signal = new AbortController().signal;
    const googleFetch = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBe(signal);
        expect(init?.method ?? "GET").toBe("GET");
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      },
    );
    const transport = createGoogleDrivePrimaryTransportV2({
      accessToken: "synthetic-token",
      controlFileId: "control-1",
      libraryId,
      epochId,
      signal,
      googleFetch,
    });
    await expect(
      transport.pageEnrollmentRequests({
        libraryId,
        storageEpochId: epochId,
        limit: 16,
      }),
    ).resolves.toEqual({ done: true, requests: [] });
    await expect(
      transport.pageActors({
        libraryId,
        storageEpochId: epochId,
        afterActorId: null,
        limit: 16,
      }),
    ).resolves.toEqual({ done: true, actorIds: [], nextActorId: null });
    await expect(
      transport.pageIntentReferences({
        libraryId,
        storageEpochId: epochId,
        actorId,
        firstActorCounter: 1,
        limit: 16,
      }),
    ).resolves.toEqual({
      done: true,
      firstActorCounter: 1,
      references: [],
      previousSegmentDigest: null,
    });
    expect(googleFetch).toHaveBeenCalledTimes(4);
  });

  it("cancels an active discovery and refuses subsequent network work", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const googleFetch = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBe(controller.signal);
        return new Promise<Response>((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(controller.signal.reason),
            { once: true },
          );
          started();
        });
      },
    );
    const transport = createGoogleDrivePrimaryTransportV2({
      accessToken: "synthetic-token",
      controlFileId: "control-1",
      libraryId,
      epochId,
      signal: controller.signal,
      googleFetch,
    });
    const result = transport.pageActors({
      libraryId,
      storageEpochId: epochId,
      afterActorId: null,
      limit: 16,
    });
    const refused = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await reading;
    controller.abort();
    await refused;
    await expect(
      transport.pageEnrollmentRequests({
        libraryId,
        storageEpochId: epochId,
        limit: 16,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(googleFetch).toHaveBeenCalledTimes(1);
  });
});

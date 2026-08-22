import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeLibraryCoreCanonicalValue,
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreLowercaseHex64,
  parseLibraryCoreFollowerActorRequestReceiptV2,
  type LibraryCoreFollowerActorRequestReceiptV2,
  type LibraryCoreEd25519PublicKeyHex,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import {
  getOrCreatePwaLibraryCoreActorIdentity,
  signPwaLibraryCoreActorProof,
} from "./library-core-browser-key-vault";
import { preparePwaLibraryCoreFollowerEnrollment } from "./library-core-pwa-follower-enrollment";

const HEX = {
  authorityKey: "11".repeat(32),
  authorityPublicKey: "22".repeat(32),
  epoch: "33".repeat(32),
  library: "44".repeat(32),
} as const;

function lowercaseHex64(value: string): LibraryCoreLowercaseHex64 {
  if (!isLibraryCoreLowercaseHex64(value)) throw new TypeError("invalid hex");
  return value;
}

function publicKeyHex(value: string): LibraryCoreEd25519PublicKeyHex {
  if (!isLibraryCoreEd25519PublicKeyHex(value)) {
    throw new TypeError("invalid public key");
  }
  return value;
}

describe("PWA Library Core follower enrollment", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: new IDBFactory(),
    });
  });

  it("constructs and stores one proof-only normalized capability request", async () => {
    const storeRequest = vi.fn(async (store) => {
      const decoded = decodeLibraryCoreCanonicalValue(
        store.canonicalRequestBytes,
      ) as never as {
        certificate_body: {
          actor_enrollment_body: {
            actor_id: string;
            actor_public_key: string;
          };
        };
        certificate_digest: string;
      };
      return parseLibraryCoreFollowerActorRequestReceiptV2({
        actorId: decoded.certificate_body.actor_enrollment_body.actor_id,
        actorPublicKey:
          decoded.certificate_body.actor_enrollment_body.actor_public_key,
        canonicalRequestBytes: store.canonicalRequestBytes,
        createdAt: store.createdAt,
        enrollmentRequestDigest: decoded.certificate_digest,
        state: "pending" as const,
      });
    });
    const candidate = await preparePwaLibraryCoreFollowerEnrollment({
      getOrCreateIdentity: getOrCreatePwaLibraryCoreActorIdentity,
      installEnrollment: vi.fn(),
      now: () => 1_000,
      readContext: vi.fn(async () => ({
        authority: {
          authority_key_id: lowercaseHex64(HEX.authorityKey),
          authority_public_key: publicKeyHex(HEX.authorityPublicKey),
          epoch: 1,
          epoch_id: lowercaseHex64(HEX.epoch),
          library_id: lowercaseHex64(HEX.library),
          observed_frontier: [],
        },
        request: null,
        schemaVersion: 2 as const,
      })),
      signActorProof: signPwaLibraryCoreActorProof,
      storeRequest,
    });

    expect(candidate).not.toBeNull();
    expect(storeRequest).toHaveBeenCalledOnce();
    const decoded = decodeLibraryCoreCanonicalValue(
      candidate!.source,
    ) as never as {
      authority_signature?: unknown;
      certificate_body: {
        actor_capability_body: {
          actor_class: string;
          scope: { mode: string };
        };
      };
    };
    expect(decoded).not.toHaveProperty("authority_signature");
    expect(decoded.certificate_body.actor_capability_body).toMatchObject({
      actor_class: "editor",
      scope: { mode: "library_wide" },
    });
    expect(candidate!.descriptor.byteLength).toBe(candidate!.source.byteLength);
    expect(candidate!.descriptor.objectKey).toContain(
      "freed-v2-enrollment-request",
    );
  });

  it("replays the exact SQLite request without creating another key", async () => {
    const receipt = {
      actorId: "55".repeat(32),
      actorPublicKey: "66".repeat(32),
      canonicalRequestBytes: Uint8Array.of(123, 125),
      createdAt: 1_000,
      enrollmentRequestDigest: "77".repeat(32),
      state: "pending",
    } as LibraryCoreFollowerActorRequestReceiptV2;
    const getOrCreateIdentity = vi.fn();
    const candidate = await preparePwaLibraryCoreFollowerEnrollment({
      getOrCreateIdentity,
      installEnrollment: vi.fn(),
      now: vi.fn(),
      readContext: vi.fn(async () => ({
        authority: {
          authority_key_id: lowercaseHex64(HEX.authorityKey),
          authority_public_key: publicKeyHex(HEX.authorityPublicKey),
          epoch: 1,
          epoch_id: lowercaseHex64(HEX.epoch),
          library_id: lowercaseHex64(HEX.library),
          observed_frontier: [],
        },
        request: receipt,
        schemaVersion: 2 as const,
      })),
      signActorProof: vi.fn(),
      storeRequest: vi.fn(),
    });

    expect(candidate?.receipt).toBe(receipt);
    expect(getOrCreateIdentity).not.toHaveBeenCalled();
  });
});

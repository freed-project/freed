import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isLibraryCoreLowercaseHex64,
  parseLibraryCoreFollowerMutationContextV1,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";

import {
  commitPwaLibraryCoreLocalSampleResult,
  createPwaLibraryCoreLocalSampleAuthority,
  markPwaLibraryCoreLocalSampleAuthorityReady,
  PwaLibraryCoreLegacyLocalSampleAuthorityError,
  preparePwaLibraryCoreLocalSampleResult,
  readPwaLibraryCoreLocalSampleAuthority,
  getOrCreatePwaLibraryCoreActorIdentity,
  signPwaLibraryCoreLocalSampleAuthority,
  signPwaLibraryCoreActorProof,
  signPwaLibraryCoreFollowerOperation,
} from "./library-core-browser-key-vault";

const HEX = {
  digest: "22".repeat(32),
  epoch: "33".repeat(32),
  library: "44".repeat(32),
} as const;

function lowercaseHex64(value: string): LibraryCoreLowercaseHex64 {
  if (!isLibraryCoreLowercaseHex64(value)) throw new TypeError("invalid hex");
  return value;
}

function context(actorId: string, actorPublicKey: string) {
  return parseLibraryCoreFollowerMutationContextV1({
    actor_id: actorId,
    actor_public_key: actorPublicKey,
    epoch: 1,
    epoch_id: HEX.epoch,
    library_id: HEX.library,
    next_actor_sequence: 1,
    observed_frontier: [],
    previous_actor_chain_digest: HEX.digest,
    previous_actor_operation_id: null,
    schema_version: 1,
  });
}

async function writeLegacyLocalSampleAuthority(
  providedPair?: CryptoKeyPair,
): Promise<void> {
  const pair =
    providedPair ??
    ((await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair);
  const authorityPublicKey = Array.from(
    new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const request = indexedDB.open("freed-library-core-key-vault-v1", 2);
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains("actor_keys")) {
      request.result.createObjectStore("actor_keys", { keyPath: "libraryId" });
    }
    if (!request.result.objectStoreNames.contains("local_sample_authority")) {
      request.result.createObjectStore("local_sample_authority", {
        keyPath: "key",
      });
    }
  });
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
  try {
    const transaction = database.transaction(
      "local_sample_authority",
      "readwrite",
    );
    transaction.objectStore("local_sample_authority").put({
      actorId: null,
      authorityKeyId: HEX.digest,
      authorityPrivateKey: pair.privateKey,
      authorityPublicKey,
      createdAt: 1,
      epochId: HEX.epoch,
      key: "active",
      libraryId: HEX.library,
      nextActorCounter: 1,
      nextResultSequence: 1,
      preparedResult: null,
      previousResultDigest: null,
      schemaVersion: 1,
      sourceRevision: 0,
      status: "preparing",
    });
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error), {
        once: true,
      });
      transaction.addEventListener("error", () => reject(transaction.error), {
        once: true,
      });
    });
  } finally {
    database.close();
  }
}

describe("PWA Library Core browser key vault", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: new IDBFactory(),
    });
  });

  it("creates one stable nonextractable actor identity per Library", async () => {
    const first = await getOrCreatePwaLibraryCoreActorIdentity(
      lowercaseHex64(HEX.library),
    );
    const second = await getOrCreatePwaLibraryCoreActorIdentity(
      lowercaseHex64(HEX.library),
    );

    expect(second).toEqual(first);
    expect(first.actorId).toMatch(/^[0-9a-f]{64}$/);
    expect(first.actorPublicKey).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      signPwaLibraryCoreActorProof(first, Uint8Array.of(1, 2, 3)),
    ).resolves.toMatch(/^[0-9a-f]{128}$/);
  });

  it("returns one durable actor identity to concurrent first creators", async () => {
    const libraryId = lowercaseHex64(HEX.library);
    const creatorCount = 8;
    const originalGenerateKey = crypto.subtle.generateKey.bind(crypto.subtle);
    let arrived = 0;
    let releaseCreators = () => {};
    const creatorsReady = new Promise<void>((resolve) => {
      releaseCreators = resolve;
    });
    const generateKey = vi
      .spyOn(crypto.subtle, "generateKey")
      .mockImplementation(async (algorithm, extractable, keyUsages) => {
        arrived += 1;
        if (arrived === creatorCount) releaseCreators();
        await creatorsReady;
        return originalGenerateKey(algorithm, extractable, keyUsages);
      });

    try {
      const identities = await Promise.all(
        Array.from({ length: creatorCount }, () =>
          getOrCreatePwaLibraryCoreActorIdentity(libraryId),
        ),
      );

      expect(arrived).toBe(creatorCount);
      for (const identity of identities) {
        expect(identity).toEqual(identities[0]);
        await expect(
          signPwaLibraryCoreActorProof(identity, Uint8Array.of(1, 2, 3)),
        ).resolves.toMatch(/^[0-9a-f]{128}$/);
      }
      await expect(
        getOrCreatePwaLibraryCoreActorIdentity(libraryId),
      ).resolves.toEqual(identities[0]);
    } finally {
      generateKey.mockRestore();
    }
  });

  it("signs with the identity accepted by SQLite", async () => {
    const identity = await getOrCreatePwaLibraryCoreActorIdentity(
      lowercaseHex64(HEX.library),
    );
    const authority = context(identity.actorId, identity.actorPublicKey);

    await expect(
      signPwaLibraryCoreFollowerOperation(
        authority,
        authority.previous_actor_chain_digest,
      ),
    ).resolves.toMatch(/^[0-9a-f]{128}$/);
  });

  it("returns one durable local sample authority to concurrent first creators", async () => {
    const creatorCount = 8;
    const originalGenerateKey = crypto.subtle.generateKey.bind(crypto.subtle);
    let arrived = 0;
    let releaseCreators = () => {};
    const creatorsReady = new Promise<void>((resolve) => {
      releaseCreators = resolve;
    });
    const generateKey = vi
      .spyOn(crypto.subtle, "generateKey")
      .mockImplementation(async (algorithm, extractable, keyUsages) => {
        arrived += 1;
        if (arrived === creatorCount) releaseCreators();
        await creatorsReady;
        return originalGenerateKey(algorithm, extractable, keyUsages);
      });

    try {
      const authorities = await Promise.all(
        Array.from({ length: creatorCount }, () =>
          createPwaLibraryCoreLocalSampleAuthority(),
        ),
      );

      expect(arrived).toBe(creatorCount);
      for (const authority of authorities) {
        expect(authority).toEqual(authorities[0]);
        await expect(
          signPwaLibraryCoreLocalSampleAuthority(
            authority,
            Uint8Array.of(1, 2, 3),
          ),
        ).resolves.toMatch(/^[0-9a-f]{128}$/);
      }
      await expect(readPwaLibraryCoreLocalSampleAuthority()).resolves.toEqual(
        authorities[0],
      );
    } finally {
      generateKey.mockRestore();
    }
  });

  it("persists local sample authority and an interrupted result receipt", async () => {
    const created = await createPwaLibraryCoreLocalSampleAuthority();
    const same = await createPwaLibraryCoreLocalSampleAuthority();
    expect(same).toEqual(created);

    const actorId = lowercaseHex64("55".repeat(32));
    const ready = await markPwaLibraryCoreLocalSampleAuthorityReady(
      created.libraryId,
      actorId,
    );
    await expect(
      signPwaLibraryCoreLocalSampleAuthority(ready, Uint8Array.of(1, 2, 3)),
    ).resolves.toMatch(/^[0-9a-f]{128}$/);

    const resultDigest = lowercaseHex64("66".repeat(32));
    await preparePwaLibraryCoreLocalSampleResult(created.libraryId, {
      canonicalResultBytes: Uint8Array.of(4, 5, 6),
      nextActorCounter: 2,
      nextResultSequence: 2,
      previousResultDigest: resultDigest,
      sourceRevision: 1,
    });
    expect(await readPwaLibraryCoreLocalSampleAuthority()).toMatchObject({
      actorId,
      nextActorCounter: 1,
      nextResultSequence: 1,
      preparedResult: {
        canonicalResultBytes: Uint8Array.of(4, 5, 6),
        previousResultDigest: resultDigest,
      },
      sourceRevision: 0,
      status: "ready",
    });

    await expect(
      commitPwaLibraryCoreLocalSampleResult(created.libraryId, resultDigest),
    ).resolves.toMatchObject({
      nextActorCounter: 2,
      nextResultSequence: 2,
      preparedResult: null,
      previousResultDigest: resultDigest,
      sourceRevision: 1,
    });
  });

  it("identifies the retired WebKit sample authority for bounded recovery", async () => {
    await writeLegacyLocalSampleAuthority();

    await expect(readPwaLibraryCoreLocalSampleAuthority()).rejects.toEqual(
      expect.objectContaining({
        libraryId: HEX.library,
        name: PwaLibraryCoreLegacyLocalSampleAuthorityError.name,
      }),
    );
  });

  it("retains legacy recovery classification when an older tab wins creation", async () => {
    const legacyPair = (await crypto.subtle.generateKey(
      { name: "Ed25519" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const originalGenerateKey = crypto.subtle.generateKey.bind(crypto.subtle);
    let markGenerationStarted = () => {};
    const generationStarted = new Promise<void>((resolve) => {
      markGenerationStarted = resolve;
    });
    let releaseGeneration = () => {};
    const generationCanContinue = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const generateKey = vi
      .spyOn(crypto.subtle, "generateKey")
      .mockImplementation(async (algorithm, extractable, keyUsages) => {
        markGenerationStarted();
        await generationCanContinue;
        return originalGenerateKey(algorithm, extractable, keyUsages);
      });

    try {
      const creation = expect(
        createPwaLibraryCoreLocalSampleAuthority(),
      ).rejects.toEqual(
        expect.objectContaining({
          libraryId: HEX.library,
          name: PwaLibraryCoreLegacyLocalSampleAuthorityError.name,
        }),
      );
      await generationStarted;
      await writeLegacyLocalSampleAuthority(legacyPair);
      releaseGeneration();
      await creation;
    } finally {
      releaseGeneration();
      generateKey.mockRestore();
    }
  });

  it("refuses an actor identity that differs from SQLite authority", async () => {
    const identity = await getOrCreatePwaLibraryCoreActorIdentity(
      lowercaseHex64(HEX.library),
    );
    const authority = context("55".repeat(32), identity.actorPublicKey);

    await expect(
      signPwaLibraryCoreFollowerOperation(
        authority,
        authority.previous_actor_chain_digest,
      ),
    ).rejects.toThrow(/does not match SQLite authority/);
  });
});

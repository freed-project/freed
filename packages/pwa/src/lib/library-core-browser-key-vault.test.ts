import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { parseLibraryCoreFollowerMutationContextV1 } from "@freed/shared/library-core";

import {
  getOrCreatePwaLibraryCoreActorIdentity,
  signPwaLibraryCoreActorProof,
  signPwaLibraryCoreFollowerOperation,
} from "./library-core-browser-key-vault";

const HEX = {
  digest: "22".repeat(32),
  epoch: "33".repeat(32),
  library: "44".repeat(32),
} as const;

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

describe("PWA Library Core browser key vault", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: new IDBFactory(),
    });
  });

  it("creates one stable nonextractable actor identity per Library", async () => {
    const first = await getOrCreatePwaLibraryCoreActorIdentity(HEX.library);
    const second = await getOrCreatePwaLibraryCoreActorIdentity(HEX.library);

    expect(second).toEqual(first);
    expect(first.actorId).toMatch(/^[0-9a-f]{64}$/);
    expect(first.actorPublicKey).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      signPwaLibraryCoreActorProof(first, Uint8Array.of(1, 2, 3)),
    ).resolves.toMatch(/^[0-9a-f]{128}$/);
  });

  it("signs with the identity accepted by SQLite", async () => {
    const identity = await getOrCreatePwaLibraryCoreActorIdentity(HEX.library);
    const authority = context(identity.actorId, identity.actorPublicKey);

    await expect(
      signPwaLibraryCoreFollowerOperation(
        authority,
        authority.previous_actor_chain_digest,
      ),
    ).resolves.toMatch(/^[0-9a-f]{128}$/);
  });

  it("refuses an actor identity that differs from SQLite authority", async () => {
    const identity = await getOrCreatePwaLibraryCoreActorIdentity(HEX.library);
    const authority = context("55".repeat(32), identity.actorPublicKey);

    await expect(
      signPwaLibraryCoreFollowerOperation(
        authority,
        authority.previous_actor_chain_digest,
      ),
    ).rejects.toThrow(/does not match SQLite authority/);
  });
});

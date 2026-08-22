import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { parseLibraryCoreFollowerMutationContextV1 } from "@freed/shared/library-core";

import { signPwaLibraryCoreFollowerOperation } from "./library-core-browser-key-vault";

const DATABASE_NAME = "freed-library-core-portable-v1";
const STORE_NAME = "portable_pwa_actor_identities";
const HEX = {
  actor: "11".repeat(32),
  digest: "22".repeat(32),
  epoch: "33".repeat(32),
  library: "44".repeat(32),
} as const;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

async function installActorKey(actorId = HEX.actor) {
  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    false,
    ["sign", "verify"],
  );
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  const actorPublicKey = Array.from(publicKey, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const open = indexedDB.open(DATABASE_NAME, 11);
  open.addEventListener(
    "upgradeneeded",
    () => open.result.createObjectStore(STORE_NAME, { keyPath: "libraryId" }),
    { once: true },
  );
  const database = await requestResult(open);
  const transaction = database.transaction(STORE_NAME, "readwrite");
  await requestResult(
    transaction.objectStore(STORE_NAME).add({
      actorId,
      actorPrivateKey: pair.privateKey,
      actorPublicKey,
      libraryId: HEX.library,
      schemaVersion: 1,
    }),
  );
  database.close();
  return { actorPublicKey, privateKey: pair.privateKey };
}

function context(actorPublicKey: string) {
  return parseLibraryCoreFollowerMutationContextV1({
    actor_id: HEX.actor,
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

  it("signs with the matching nonextractable actor key", async () => {
    const installed = await installActorKey();
    const authority = context(installed.actorPublicKey);

    const signature = await signPwaLibraryCoreFollowerOperation(
      authority,
      authority.previous_actor_chain_digest,
    );

    expect(signature).toMatch(/^[0-9a-f]{128}$/);
    expect(installed.privateKey.extractable).toBe(false);
  });

  it("refuses a key whose actor identity differs from SQLite authority", async () => {
    const installed = await installActorKey("55".repeat(32));
    const authority = context(installed.actorPublicKey);

    await expect(
      signPwaLibraryCoreFollowerOperation(
        authority,
        authority.previous_actor_chain_digest,
      ),
    ).rejects.toThrow(/does not match SQLite authority/);
  });
});

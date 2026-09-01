import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signEd25519,
} from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  encodeLibraryCoreDigestInput,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
} from "./canonical-codec.js";
import {
  constructLibraryCoreAgentQueryV1,
  verifyLibraryCoreAgentQueryV1,
} from "./agent-query-contracts.js";
import { verifyLibraryCoreEd25519WithWebCrypto } from "./ed25519-verification.js";
import agentQueryVector from "./agent-query-v1-vectors.json" with { type: "json" };

const ACTOR_SEED =
  "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb";
const ED25519_PKCS8_SEED_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

function actorPrivateKey() {
  return createPrivateKey({
    key: Buffer.concat([
      ED25519_PKCS8_SEED_PREFIX,
      Buffer.from(ACTOR_SEED, "hex"),
    ]),
    format: "der",
    type: "pkcs8",
  });
}

function actorPublicKeyHex(): string {
  const bytes = createPublicKey(actorPrivateKey()).export({
    format: "der",
    type: "spki",
  });
  return bytes.subarray(bytes.byteLength - 32).toString("hex");
}

function digest(domain: LibraryCoreDigestDomain, value: unknown): string {
  return createHash("sha256")
    .update(
      encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue),
    )
    .digest("hex");
}

async function construct(query: Readonly<Record<string, unknown>>) {
  return constructLibraryCoreAgentQueryV1(
    {
      library_id: "11".repeat(32) as never,
      epoch: 3,
      epoch_id: "22".repeat(32) as never,
      actor_id: "33".repeat(32) as never,
      capability_id: "44".repeat(32) as never,
      capability_certificate_digest: "44".repeat(32) as never,
      request_id: "55".repeat(32) as never,
      query,
    },
    {
      digest,
      async signActor(message) {
        return signEd25519(null, message, actorPrivateKey()).toString("hex");
      },
    },
  );
}

describe("Library Core signed agent query", () => {
  it("constructs and verifies canonical registered query bytes", async () => {
    const built = await construct({
      globalId: "missing:item",
      queryId: "item_detail_v1",
      schemaVersion: 1,
    });
    const bytes = Buffer.from(built.canonical_agent_query_json, "utf8");
    expect(agentQueryVector.schema_version).toBe(1);
    expect(agentQueryVector.actor_seed_hex).toBe(ACTOR_SEED);
    expect(agentQueryVector.actor_public_key_hex).toBe(actorPublicKeyHex());
    expect(built.canonical_agent_query_json).toBe(
      agentQueryVector.canonical_agent_query_json,
    );
    await expect(
      verifyLibraryCoreAgentQueryV1(bytes, actorPublicKeyHex() as never, {
        digest,
        verifySignature: verifyLibraryCoreEd25519WithWebCrypto,
      }),
    ).resolves.toStrictEqual(built.envelope);
    expect(JSON.parse(built.canonical_agent_query_json)).toStrictEqual(
      JSON.parse(JSON.stringify(built.envelope)),
    );
  });

  it("rejects unregistered selectors, changed capability identity, and noncanonical bytes", async () => {
    await expect(
      construct({ queryId: "raw_sql_v1", sql: "SELECT *" }),
    ).rejects.toThrow("agent query body is invalid");
    await expect(
      constructLibraryCoreAgentQueryV1(
        {
          library_id: "11".repeat(32) as never,
          epoch: 3,
          epoch_id: "22".repeat(32) as never,
          actor_id: "33".repeat(32) as never,
          capability_id: "44".repeat(32) as never,
          capability_certificate_digest: "45".repeat(32) as never,
          request_id: "55".repeat(32) as never,
          query: { globalId: "item:one", queryId: "item_detail_v1" },
        },
        { digest, signActor: async () => "66".repeat(64) },
      ),
    ).rejects.toThrow("agent query body is invalid");

    const built = await construct({
      globalId: "item:one",
      queryId: "item_detail_v1",
    });
    await expect(
      verifyLibraryCoreAgentQueryV1(
        Buffer.from(`${built.canonical_agent_query_json} `),
        actorPublicKeyHex() as never,
        {
          digest,
          verifySignature: verifyLibraryCoreEd25519WithWebCrypto,
        },
      ),
    ).rejects.toThrow();
  });
});

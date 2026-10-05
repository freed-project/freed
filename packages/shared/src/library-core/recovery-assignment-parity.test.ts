import { createHash, createPrivateKey, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import vectors from "./recovery-assignment-vectors-v1.json";
import { encodeLibraryCoreCanonicalValue, encodeLibraryCoreDigestInput, type LibraryCoreCanonicalValue, type LibraryCoreDigestDomain } from "./canonical-codec.js";
import { FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA, FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA, FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA, FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA } from "./operation-envelope-contracts.js";
import { assembleLibraryCoreTransactionV1 } from "./operation-transaction-contracts.js";
import { finalizeLibraryCoreTransactionV1 } from "./operation-envelope-finalization.js";

const schemas = [FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA, FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA, FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA, FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA] as const;
const digest = (domain: string, value: unknown) => createHash("sha256").update(encodeLibraryCoreDigestInput(domain as LibraryCoreDigestDomain, value as LibraryCoreCanonicalValue)).digest("hex");
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 19)]), format: "der", type: "pkcs8" });

describe("native recovery assignment canonical parity", () => {
  it("matches every fresh signed envelope, including Unicode, retained frontier and false assignments", async () => {
    const actual: string[][] = [];
    for (const [kind, schema] of schemas.entries()) {
      const members = ["rss:é:😀", "rss:item:2"].map((entity_id, index) => {
        const input = {
          operation_id: `recovery:parity:${index}`, library_id: "1".repeat(64), epoch: 2, epoch_id: "2".repeat(64), actor_id: "3".repeat(64),
          actor_sequence: 7 + index, previous_actor_operation_id: index === 0 ? "previous:6" : "recovery:parity:0",
          causal_frontier: [{ actor_id: "4".repeat(64), sequence: 2, operation_id: "frontier:2", chain_digest: "5".repeat(64) }],
          hlc_wall_ms: 5000, hlc_counter: 0, transaction_id: "recovery:parity", transaction_member_index: index,
          transaction_member_count: 2, entity_id, created_at_ms: 5000,
          payload: kind === 0 ? { read_at_ms: 5000 } : { assigned: index === 0, assigned_at_ms: 5000 },
        };
        return schema.construct(input as Parameters<typeof schema.construct>[0], { digest });
      });
      const assembled = assembleLibraryCoreTransactionV1(members, "6".repeat(64), { digest });
      const result = await finalizeLibraryCoreTransactionV1(assembled, { digest,
        signOperation: async (message) => sign(null, message, privateKey).toString("hex") as never });
      actual.push(result.members.map((member) => createHash("sha256").update(encodeLibraryCoreCanonicalValue(member.envelope as unknown as LibraryCoreCanonicalValue)).digest("hex")));
    }
    expect(actual).toEqual(vectors.envelopeSha256);
  });
});

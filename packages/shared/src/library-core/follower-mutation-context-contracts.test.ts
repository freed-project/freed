import { describe, expect, it } from "vitest";

import { parseLibraryCoreFollowerMutationContextV1 } from "./follower-mutation-context-contracts.js";

const HEX = {
  actor: "11".repeat(32),
  chain: "22".repeat(32),
  frontierActor: "33".repeat(32),
  frontierChain: "44".repeat(32),
  publicKey:
    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
} as const;

function context() {
  return {
    actor_id: HEX.actor,
    actor_public_key: HEX.publicKey,
    epoch: 3,
    epoch_id: "epoch:3",
    library_id: "library:fixture",
    next_actor_sequence: 8,
    observed_frontier: [
      {
        actor_id: HEX.frontierActor,
        chain_digest: HEX.frontierChain,
        operation_id: "operation:frontier:7",
        sequence: 7,
      },
    ],
    previous_actor_chain_digest: HEX.chain,
    previous_actor_operation_id: "operation:actor:7",
    schema_version: 1,
  } as const;
}

describe("Library Core follower mutation context", () => {
  it("snapshots a closed context and its bounded causal frontier", () => {
    const parsed = parseLibraryCoreFollowerMutationContextV1(context());

    expect(parsed).toStrictEqual(context());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.observed_frontier)).toBe(true);
    expect(Object.isFrozen(parsed.observed_frontier[0])).toBe(true);
  });

  it("requires the actor tip to agree with its next sequence", () => {
    expect(() =>
      parseLibraryCoreFollowerMutationContextV1({
        ...context(),
        next_actor_sequence: 1,
      }),
    ).toThrow(/actor tip is invalid/);
    expect(() =>
      parseLibraryCoreFollowerMutationContextV1({
        ...context(),
        next_actor_sequence: 1,
        previous_actor_operation_id: null,
      }),
    ).not.toThrow();
  });

  it("rejects unknown fields and invalid authority identities", () => {
    expect(() =>
      parseLibraryCoreFollowerMutationContextV1({
        ...context(),
        compatibilityShell: true,
      }),
    ).toThrow(/fields are invalid/);
    expect(() =>
      parseLibraryCoreFollowerMutationContextV1({
        ...context(),
        actor_public_key: "invalid",
      }),
    ).toThrow(/identity is invalid/);
  });
});

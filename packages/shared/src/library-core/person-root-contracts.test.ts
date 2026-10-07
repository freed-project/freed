import { expect, it } from "vitest";
import { parseLibraryCorePersonRootRequestV1, parseLibraryCorePersonRootResponseV1 } from "./person-root-contracts.js";
const request = { queryId: "person_root_v1", schemaVersion: 1, personId: "person:one" } as const;
const person = { id: request.personId, name: "Full root", relationshipStatus: "friend", careLevel: 3, createdAt: 1, updatedAt: 2 };
const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 9 };
const response = (root: unknown) => ({ ...request, person: root, source });
it("retains every legal tag beyond display limits and snapshots validated roots", () => {
  for (const count of [64, 65, 4096]) {
    const tags = Array.from({ length: count }, (_, i) => `t${i}`);
    const parsed = parseLibraryCorePersonRootResponseV1(response({ ...person, tags }), request);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.person?.tags).toEqual(tags);
    tags.push("changed");
    expect(parsed.value.person?.tags).toHaveLength(count);
  }
});
it("rejects oversized roots, wrong identities, history and unknown fields without truncation", () => {
  for (const root of [{ ...person, tags: Array(4097).fill("a") }, { ...person, notes: "x".repeat(65536) }, { ...person, id: "wrong" }, { ...person, reachOutLog: [] }, { ...person, futureField: true }])
    expect(parseLibraryCorePersonRootResponseV1(response(root), request).ok).toBe(false);
  expect(parseLibraryCorePersonRootResponseV1(response(null), request).ok).toBe(true);
  expect(parseLibraryCorePersonRootRequestV1({ ...request, cursor: null }).ok).toBe(false);
});

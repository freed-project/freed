import { describe, expect, it } from "vitest";
import {
  parseLibraryCoreDeviceGraphLayoutMutationResultV1,
  parseLibraryCoreDeviceGraphLayoutMutationV1,
} from "./device-graph-layout-mutation-contracts.js";

describe("device graph layout mutation contracts", () => {
  it("accepts closed bounded set and clear mutations", () => {
    expect(
      parseLibraryCoreDeviceGraphLayoutMutationV1({
        entityId: "person-1",
        graphX: 12.5,
        graphY: -8.25,
        mutationId: "person_graph_position_set_v1",
        schemaVersion: 1,
        updatedAt: 42,
      }).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreDeviceGraphLayoutMutationV1({
        entityId: "account-1",
        mutationId: "account_graph_position_clear_v1",
        schemaVersion: 1,
      }).ok,
    ).toBe(true);
  });

  it("rejects extra fields, nonfinite coordinates, and malformed results", () => {
    expect(
      parseLibraryCoreDeviceGraphLayoutMutationV1({
        entityId: "person-1",
        graphX: Number.NaN,
        graphY: 0,
        mutationId: "person_graph_position_set_v1",
        schemaVersion: 1,
        updatedAt: 42,
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreDeviceGraphLayoutMutationV1({
        entityId: "person-1",
        extra: true,
        mutationId: "person_graph_position_clear_v1",
        schemaVersion: 1,
      }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreDeviceGraphLayoutMutationResultV1({
        changed: 1,
        layoutRevision: 0,
        mutationId: "person_graph_position_clear_v1",
        schemaVersion: 1,
      }).ok,
    ).toBe(false);
    let accessed = false;
    const accessor = Object.defineProperty(
      {
        entityId: "person-1",
        mutationId: "person_graph_position_clear_v1",
        schemaVersion: 1,
      },
      "entityId",
      {
        enumerable: true,
        get() {
          accessed = true;
          return "person-1";
        },
      },
    );
    expect(parseLibraryCoreDeviceGraphLayoutMutationV1(accessor).ok).toBe(false);
    expect(accessed).toBe(false);
  });
});

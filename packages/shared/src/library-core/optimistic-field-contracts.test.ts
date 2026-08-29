import { describe, expect, it } from "vitest";
import type { FeedItem } from "../types.js";
import {
  applyLibraryCoreOptimisticFieldsV1,
  parseLibraryCoreOptimisticFieldsRequestV1,
  parseLibraryCoreOptimisticFieldsResponseV1,
} from "./optimistic-field-contracts.js";

const request = Object.freeze({
  entityIds: Object.freeze(["item-1"]),
  queryId: "optimistic_fields_v1" as const,
  schemaVersion: 1 as const,
});

const source = Object.freeze({
  generationId: "a".repeat(64),
  projectionRevision: 9,
  transitionSequence: 4,
});

describe("optimistic field query contracts", () => {
  it("snapshots a bounded unique identity request", () => {
    const entityIds = ["item-1"];
    const parsed = parseLibraryCoreOptimisticFieldsRequestV1({
      entityIds,
      queryId: "optimistic_fields_v1",
      schemaVersion: 1,
    });
    expect(parsed).toEqual({ ok: true, value: request });
    entityIds[0] = "changed";
    expect(parsed.ok && parsed.value.entityIds).toEqual(["item-1"]);
    expect(
      parseLibraryCoreOptimisticFieldsRequestV1({
        ...request,
        entityIds: ["item-1", "item-1"],
      }).ok,
    ).toBe(false);
  });

  it("rejects duplicate or mismatched sparse fields", () => {
    const row = {
      entityId: "item-1",
      fieldPath: "saved",
      value: true,
      valueType: "boolean",
    };
    expect(
      parseLibraryCoreOptimisticFieldsResponseV1(
        {
          queryId: "optimistic_fields_v1",
          rows: [row],
          schemaVersion: 1,
          source,
        },
        request,
      ).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreOptimisticFieldsResponseV1(
        {
          queryId: "optimistic_fields_v1",
          rows: [row, row],
          schemaVersion: 1,
          source,
        },
        request,
      ).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreOptimisticFieldsResponseV1(
        {
          queryId: "optimistic_fields_v1",
          rows: [{ ...row, value: 1 }],
          schemaVersion: 1,
          source,
        },
        request,
      ).ok,
    ).toBe(false);
  });

  it("merges only the sparse user-state fields", () => {
    const item = {
      globalId: "item-1",
      userState: {
        archived: false,
        hidden: false,
        saved: false,
        tags: [],
      },
    } as unknown as FeedItem;
    expect(
      applyLibraryCoreOptimisticFieldsV1(item, [
        {
          entityId: "item-1",
          fieldPath: "saved",
          value: true,
          valueType: "boolean",
        },
        {
          entityId: "item-1",
          fieldPath: "saved_at",
          value: 1_700,
          valueType: "integer",
        },
      ]).userState,
    ).toEqual({
      archived: false,
      hidden: false,
      saved: true,
      savedAt: 1_700,
      tags: [],
    });
  });
});

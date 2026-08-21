import { describe, expect, it } from "vitest";
import {
  createLibraryCoreSqliteWorkerRequest,
  parseLibraryCoreSqliteWorkerRequest,
} from "./sqlite-worker-protocol.js";

describe("Library Core SQLite worker protocol", () => {
  it("creates a closed versioned request", () => {
    expect(createLibraryCoreSqliteWorkerRequest("open", "request-1")).toEqual({
      kind: "open",
      protocolVersion: 2,
      requestId: "request-1",
    });
  });

  it("rejects unknown fields, versions, kinds, and unbounded identities", () => {
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({
        kind: "open",
        protocolVersion: 2,
        requestId: "request-1",
        sql: "DROP TABLE library_meta",
      }),
    ).toThrow(/identity is invalid/);
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({
        kind: "open",
        protocolVersion: 1,
        requestId: "request-1",
      }),
    ).toThrow(/identity is invalid/);
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({
        kind: "execute_sql",
        protocolVersion: 2,
        requestId: "request-1",
      }),
    ).toThrow(/identity is invalid/);
    expect(() =>
      parseLibraryCoreSqliteWorkerRequest({
        kind: "open",
        protocolVersion: 2,
        requestId: "x".repeat(256),
      }),
    ).toThrow(/identity is invalid/);
  });
});

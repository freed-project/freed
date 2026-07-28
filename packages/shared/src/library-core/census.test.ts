import { describe, expect, it } from "vitest";

import {
  LIBRARY_CORE_CENSUS,
  LIBRARY_CORE_CENSUS_BLOCKERS,
} from "./census.js";

describe("Library Core dormant census", () => {
  it("cannot be mistaken for writer or activation authority", () => {
    expect(LIBRARY_CORE_CENSUS).toMatchObject({
      status: "dormant_incomplete",
      activationAllowed: false,
      runtimeBehaviorChanged: false,
      activeEngine: "automerge_legacy",
      replicationProtocol: "automerge_blob_v1",
    });
  });

  it("keeps the typed blocker vocabulary stable, sorted, and nonempty", () => {
    expect(LIBRARY_CORE_CENSUS_BLOCKERS.length).toBeGreaterThan(0);
    expect([...LIBRARY_CORE_CENSUS_BLOCKERS]).toStrictEqual(
      [...LIBRARY_CORE_CENSUS_BLOCKERS].sort(),
    );
    expect(new Set(LIBRARY_CORE_CENSUS_BLOCKERS).size).toBe(
      LIBRARY_CORE_CENSUS_BLOCKERS.length,
    );
  });

  it("names every census surface without claiming that its successor exists", () => {
    expect(LIBRARY_CORE_CENSUS.registrySurfaces).toStrictEqual([
      "field",
      "root",
      "operation",
      "query",
      "shared_store",
      "desktop_worker_message",
      "pwa_worker_message",
      "local_authority",
    ]);
  });
});

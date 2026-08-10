import { describe, expect, it } from "vitest";

import { LIBRARY_CORE_CENSUS, LIBRARY_CORE_CENSUS_BLOCKERS } from "./census.js";

describe("Library Core census", () => {
  it("records the active Desktop engine without claiming replacement replication", () => {
    expect(LIBRARY_CORE_CENSUS).toMatchObject({
      status: "desktop_sqlite_active_replacement_incomplete",
      activationAllowed: false,
      runtimeBehaviorChanged: true,
      runtimeBehaviorChange: "desktop_local_sqlite_import_read_write_backup_cutover",
      activeEngine: "sqlite_desktop_v2",
      replicationProtocol: "replacement_transport_pending",
      legacyEpochBootstrapContract: "closed_dormant_v1",
      legacyEpochBootstrapTrust: "tofu_read_only",
      legacyEpochBootstrapTransactionImplemented: false,
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
      "legacy_epoch_bootstrap_contract",
    ]);
  });
});

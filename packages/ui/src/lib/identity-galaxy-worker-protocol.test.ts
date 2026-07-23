import { describe, expect, it } from "vitest";
import {
  identityGalaxyWorkerResponseDisposition,
  identityGalaxyWorkerSelectionsMatch,
  shouldReconcileIdentityGalaxyWorkerSelection,
  shouldRequestIdentityGalaxyWorkerSelection,
} from "./identity-galaxy-worker-protocol.js";

describe("identity galaxy worker selection", () => {
  it("rejects an older pending response after the selected identity changes", () => {
    expect(shouldReconcileIdentityGalaxyWorkerSelection(
      { selectedPersonId: null, selectedAccountId: null },
      { selectedPersonId: "person-399", selectedAccountId: null },
    )).toBe(true);
    expect(shouldReconcileIdentityGalaxyWorkerSelection(
      { selectedPersonId: "person-399", selectedAccountId: null },
      { selectedPersonId: null, selectedAccountId: "account-999" },
    )).toBe(true);
  });

  it("accepts the response for the current selection tuple", () => {
    expect(identityGalaxyWorkerSelectionsMatch(
      { selectedPersonId: undefined, selectedAccountId: undefined },
      { selectedPersonId: null, selectedAccountId: null },
    )).toBe(true);
    expect(shouldReconcileIdentityGalaxyWorkerSelection(
      { selectedPersonId: null, selectedAccountId: "account-999" },
      { selectedPersonId: null, selectedAccountId: "account-999" },
    )).toBe(false);
  });

  it("deduplicates the passive selection effect after stale-response recovery queues the same tuple", () => {
    const currentSelection = {
      selectedPersonId: "person-399",
      selectedAccountId: null,
    };
    expect(shouldRequestIdentityGalaxyWorkerSelection(
      { selectedPersonId: null, selectedAccountId: null },
      currentSelection,
    )).toBe(true);
    expect(shouldRequestIdentityGalaxyWorkerSelection(
      currentSelection,
      currentSelection,
    )).toBe(false);
  });

  it("reconciles a pending older response and ignores it after the current response wins", () => {
    const oldSelection = { selectedPersonId: null, selectedAccountId: null };
    const currentSelection = {
      selectedPersonId: "person-399",
      selectedAccountId: null,
    };
    expect(identityGalaxyWorkerResponseDisposition(
      1,
      0,
      oldSelection,
      currentSelection,
    )).toBe("reconcile");
    expect(identityGalaxyWorkerResponseDisposition(
      2,
      1,
      currentSelection,
      currentSelection,
    )).toBe("apply");
    expect(identityGalaxyWorkerResponseDisposition(
      1,
      2,
      oldSelection,
      currentSelection,
    )).toBe("ignore");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isCloudReconciled,
  markCloudReconciled,
  onCloudReconciled,
  resetCloudReconcileSignalForTests,
} from "./cloud-reconcile-signal";

// The contract this file protects: startup maintenance is DEFERRED until cloud
// sync reconciles, never skipped. The previous implementation skipped it
// outright whenever cloud credentials existed, so archive pruning never ran on
// a machine with a cloud provider connected and the Automerge document grew
// without bound.
describe("cloud reconcile signal", () => {
  beforeEach(() => {
    resetCloudReconcileSignalForTests();
  });

  it("starts unreconciled so maintenance cannot run before a remote merge", () => {
    expect(isCloudReconciled()).toBe(false);
  });

  it("releases waiters registered before reconciliation", () => {
    const waiter = vi.fn();
    onCloudReconciled(waiter);
    expect(waiter).not.toHaveBeenCalled();

    markCloudReconciled("gdrive");

    expect(waiter).toHaveBeenCalledTimes(1);
    expect(isCloudReconciled()).toBe(true);
  });

  it("runs a waiter immediately when reconciliation already happened", () => {
    markCloudReconciled("gdrive");
    const waiter = vi.fn();

    onCloudReconciled(waiter);

    expect(waiter).toHaveBeenCalledTimes(1);
  });

  it("releases waiters only once across multiple providers", () => {
    const waiter = vi.fn();
    onCloudReconciled(waiter);

    markCloudReconciled("gdrive");
    markCloudReconciled("dropbox");

    // A second provider merges into an already-reconciled document, so
    // re-running the full maintenance scan would repeat a full Automerge load
    // for no new information.
    expect(waiter).toHaveBeenCalledTimes(1);
  });

  it("cancels a waiter that is torn down before reconciliation", () => {
    const waiter = vi.fn();
    const cancel = onCloudReconciled(waiter);

    cancel();
    markCloudReconciled("gdrive");

    expect(waiter).not.toHaveBeenCalled();
  });

  it("keeps releasing waiters when one of them throws", () => {
    const failing = vi.fn(() => {
      throw new Error("maintenance scheduling failed");
    });
    const following = vi.fn();
    onCloudReconciled(failing);
    onCloudReconciled(following);

    expect(() => markCloudReconciled("gdrive")).not.toThrow();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(following).toHaveBeenCalledTimes(1);
  });

  it("does not re-run a waiter that already fired", () => {
    const waiter = vi.fn();
    onCloudReconciled(waiter);

    markCloudReconciled("gdrive");
    markCloudReconciled("gdrive");

    expect(waiter).toHaveBeenCalledTimes(1);
  });
});

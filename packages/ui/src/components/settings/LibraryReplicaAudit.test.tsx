/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { parseLibraryCoreNormalizedReplicaAuditV1 } from "@freed/shared/library-core";
import { LibraryReplicaAudit } from "./LibraryReplicaAudit";

const mocks = vi.hoisted(() => ({ copy: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/clipboard.js", () => ({ copyExactJsonToClipboard: mocks.copy }));
vi.mock("../../lib/build-info.js", () => ({ readBuildMetadata: () => ({
  appVersion: "test", buildKind: "local", commitSha: null, commitRef: null, deployedAt: null,
}) }));

it("discards cancelled results, copies fresh evidence and aborts on close", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const receipt = parseLibraryCoreNormalizedReplicaAuditV1({
    format: "freed_normalized_replica_audit_v1", checkpointDigest: "d".repeat(64),
    snapshot: { format: "freed_normalized_checkpoint_export_v2", protocolVersion: 2,
      libraryId: "a".repeat(64), authorityEpoch: "b".repeat(64), writerId: "c".repeat(64),
      sourceRevision: 1234, causalFrontierDigest: "e".repeat(64), recordCount: 2, itemCount: 0 },
  });
  let finish!: (value: typeof receipt) => void;
  const signals: AbortSignal[] = [];
  const audit = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return new Promise<typeof receipt>((resolve) => { finish = resolve; });
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const click = async (label: string) => act(async () => {
    const button = [...host.querySelectorAll("button")].find(node => node.textContent === label);
    expect(button).toBeDefined(); button!.click();
  });
  let unmounted = false;
  try {
    await act(async () => root.render(<LibraryReplicaAudit audit={audit} client="desktop" />));
    await click("Audit this Library");
    await click("Cancel audit");
    expect(signals[0]!.aborted).toBe(true);
    await act(async () => finish(receipt));
    expect(host.textContent).not.toContain("Copy audit receipt");
    await click("Audit this Library");
    await act(async () => finish(receipt));
    expect(host.textContent).toContain((1234).toLocaleString());
    await click("Copy audit receipt");
    expect(mocks.copy).toHaveBeenCalledWith(expect.objectContaining({
      client: "desktop", audit: receipt,
      interfaceBuild: expect.objectContaining({ buildKind: "local", commitSha: null }),
      startedAt: expect.any(String), completedAt: expect.any(String),
    }));
    audit.mockRejectedValueOnce(new Error("AUDIT_DEADLINE"));
    await click("Audit this Library");
    expect(host.textContent).toContain("The audit reached its time limit. No receipt was produced.");
    expect(host.textContent).not.toContain("Copy audit receipt");
    await click("Audit this Library");
    await act(async () => root.unmount()); unmounted = true;
    expect(signals[2]!.aborted).toBe(true);
    await act(async () => finish(receipt));
  } finally {
    if (!unmounted) await act(async () => root.unmount());
    host.remove();
  }
});

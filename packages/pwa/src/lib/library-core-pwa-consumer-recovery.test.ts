import { describe, expect, it, vi } from "vitest";
import { parseLibraryCoreConsumerRecoveryStatusV1, decodeLibraryCoreCanonicalValue, encodeLibraryCoreDigestInput, sha256LowerHex, type LibraryCoreConsumerRecoveryStatusV1 } from "@freed/shared/library-core";
import { continuePwaConsumerRecovery } from "./library-core-pwa-consumer-recovery";
const id = "1".repeat(64), key = "2".repeat(64), epoch = "3".repeat(64);
const recoveredActor = sha256LowerHex(encodeLibraryCoreDigestInput("actor-id", {
  library_id: id, installation_incarnation: id, signature_algorithm: "ed25519", actor_public_key: key, actor_incarnation_nonce: id,
}));
type Runtime = NonNullable<Parameters<typeof continuePwaConsumerRecovery>[0]>;
function status(state: "required" | "prepared" | "following") {
  return parseLibraryCoreConsumerRecoveryStatusV1({ state, pendingIntentCount: 2, publishedIntentCount: 1,
    plan: { recoveryId: id, oldActorId: id, actorPublicKey: key, installationIncarnation: id, predecessorEpochId: id,
      authority: { library_id: id, epoch_id: epoch, epoch: 2, authority_key_id: key, authority_public_key: key, observed_frontier: [] },
      preparedRequest: state === "required" ? null : { canonicalRequestBytes: Uint8Array.of(123, 125), createdAt: 1 } } });
}
describe("explicit browser recovery orchestration", () => {
  function runtime(initial: LibraryCoreConsumerRecoveryStatusV1) {
    return { read: vi.fn(async () => initial), prepare: vi.fn<Runtime["prepare"]>(async () => status("prepared")), commit: vi.fn(async () => status("following")),
      identity: vi.fn(async () => ({ libraryId: id, actorId: recoveredActor, actorPublicKey: key, installationIncarnation: id,
        actorIncarnationNonce: id, schemaVersion: 1 }) as never), sign: vi.fn(async () => "4".repeat(128) as never), now: () => 2 };
  }
  it("constructs and persists exactly one retained-key enrollment before committing", async () => {
    const calls = runtime(status("required"));
    await expect(continuePwaConsumerRecovery(calls)).resolves.toMatchObject({ state: "following" });
    expect(calls.sign).toHaveBeenCalledOnce(); expect(calls.prepare).toHaveBeenCalledOnce(); expect(calls.commit).toHaveBeenCalledOnce();
    const sent = calls.prepare.mock.calls[0]![0];
    expect(sent.recoveryId).toBe(id);
    expect(decodeLibraryCoreCanonicalValue(sent.request.canonicalRequestBytes)).toMatchObject({
      certificate_body: { actor_enrollment_body: { actor_id: recoveredActor, actor_public_key: key, actor_incarnation_nonce: id, epoch_id: epoch } },
    });
  });
  it("resumes persisted preparation without signing or preparing another request", async () => {
    const calls = runtime(status("prepared"));
    await expect(continuePwaConsumerRecovery(calls)).resolves.toMatchObject({ state: "following" });
    expect(calls.sign).not.toHaveBeenCalled(); expect(calls.prepare).not.toHaveBeenCalled();
    expect(calls.commit).toHaveBeenCalledWith({ recoveryId: id, committedAt: 2 });
  });
  it("returns an already committed result without another mutation or key access", async () => {
    const calls = runtime(status("following"));
    await expect(continuePwaConsumerRecovery(calls)).resolves.toMatchObject({ state: "following" });
    expect(calls.identity).not.toHaveBeenCalled(); expect(calls.commit).not.toHaveBeenCalled();
  });
  it("stops when the retained key is missing or commit is ambiguous", async () => {
    const calls = runtime(status("prepared"));
    calls.identity.mockRejectedValueOnce(new Error("key missing"));
    await expect(continuePwaConsumerRecovery(calls)).rejects.toThrow("key missing");
    expect(calls.commit).not.toHaveBeenCalled();
    calls.commit.mockRejectedValueOnce(new Error("response lost"));
    await expect(continuePwaConsumerRecovery(calls)).rejects.toThrow("response lost");
    expect(calls.commit).toHaveBeenCalledTimes(1); expect(calls.sign).not.toHaveBeenCalled();
  });
});

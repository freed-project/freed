import { describe, expect, it } from "vitest";

import {
  createLibraryCoreNativeCommandClientV1,
  LibraryCoreNativeCommandFailure,
} from "./native-command.js";
import { FakeEntropy, FakeSidecarProcess } from "./testing/fakes.js";

function response(
  request: Uint8Array,
  value: Readonly<Record<string, unknown>>,
): Uint8Array {
  const parsed = JSON.parse(Buffer.from(request).toString("utf8")) as {
    requestId: string;
  };
  return Buffer.from(
    JSON.stringify({
      protocolVersion: 1,
      requestId: parsed.requestId,
      ...value,
    }),
  );
}

describe("Library Core native command client", () => {
  it("executes any generated command through one closed request and response frame", async () => {
    const child = new FakeSidecarProcess();
    child.exchangeCommand = async (request, maximumResponseBytes) => {
      expect(maximumResponseBytes).toBe(4_194_304);
      expect(JSON.parse(Buffer.from(request).toString("utf8"))).toEqual({
        protocolVersion: 1,
        requestId: "1".repeat(64),
        commandId: "primary_actor_identity_v1",
        payload: { installationWitness: "2".repeat(64) },
      });
      return response(request, {
        ok: true,
        result: { actorId: "3".repeat(64), libraryId: "4".repeat(64) },
      });
    };
    const client = createLibraryCoreNativeCommandClientV1(
      child,
      new FakeEntropy(),
    );

    await expect(
      client.execute("primary_actor_identity_v1", {
        installationWitness: "2".repeat(64),
      }),
    ).resolves.toEqual({
      actorId: "3".repeat(64),
      libraryId: "4".repeat(64),
    });
  });

  it.each([
    ["changed request identity", { requestId: "9".repeat(64) }],
    ["unknown success field", { extra: true }],
    ["missing result", { result: undefined }],
  ])("rejects a %s", async (_label, replacement) => {
    const child = new FakeSidecarProcess();
    child.exchangeCommand = async (request) => {
      const encoded = response(request, { ok: true, result: {} });
      const parsed = JSON.parse(Buffer.from(encoded).toString("utf8"));
      Object.assign(parsed, replacement);
      if (Object.hasOwn(replacement, "result")) delete parsed.result;
      return Buffer.from(JSON.stringify(parsed));
    };
    const client = createLibraryCoreNativeCommandClientV1(
      child,
      new FakeEntropy(),
    );

    await expect(
      client.execute("inspect_storage_v1", {}),
    ).rejects.toMatchObject({ code: "command_response_invalid" });
  });

  it("maps a closed native refusal without exposing its detail", async () => {
    const child = new FakeSidecarProcess();
    child.exchangeCommand = async (request) =>
      response(request, { errorCode: "request_invalid", ok: false });
    const client = createLibraryCoreNativeCommandClientV1(
      child,
      new FakeEntropy(),
    );

    await expect(
      client.execute("reassign_writer_epoch_v2", {}),
    ).rejects.toEqual(new LibraryCoreNativeCommandFailure("request_invalid"));
  });

  it("rejects a native error code absent from the executable contract", async () => {
    const child = new FakeSidecarProcess();
    child.exchangeCommand = async (request) =>
      response(request, { errorCode: "mystery_failure", ok: false });
    const client = createLibraryCoreNativeCommandClientV1(
      child,
      new FakeEntropy(),
    );

    await expect(
      client.execute("inspect_storage_v1", {}),
    ).rejects.toMatchObject({ code: "command_response_invalid" });
  });
});

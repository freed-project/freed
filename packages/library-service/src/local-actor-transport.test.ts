import { describe, expect, it, vi } from "vitest";

import {
  createLibraryServiceLocalActorProcessorV1,
  type LibraryServiceLocalActorBackendV1,
} from "./local-actor-transport.js";
import { Deferred } from "./testing/fakes.js";

function request(
  requestId = "1".repeat(64),
  payload: Readonly<Record<string, unknown>> = {
    page: { records: [] },
  },
): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      method: "submit_signed_intent_page_v1",
      payload,
      protocolVersion: 1,
      requestId,
    }),
  );
}

function decoded(bytes: Uint8Array): Record<string, unknown> {
  const text = Buffer.from(bytes).toString("utf8");
  expect(text.endsWith("\n")).toBe(true);
  return JSON.parse(text) as Record<string, unknown>;
}

describe("Library service local actor transport", () => {
  it("admits one bounded signed intent page through the restricted backend", async () => {
    const submitSignedIntentPage = vi.fn(async () => ({
      acceptedTransactions: 1,
    }));
    const processor = createLibraryServiceLocalActorProcessorV1(
      { submitSignedIntentPage },
      { nowMs: () => 1_000 },
    );

    await expect(processor.executeFrame(request())).resolves.toEqual(
      expect.any(Uint8Array),
    );
    expect(decoded(await processor.executeFrame(request()))).toEqual({
      ok: true,
      protocolVersion: 1,
      requestId: "1".repeat(64),
      result: { acceptedTransactions: 1 },
    });
    expect(submitSignedIntentPage).toHaveBeenCalledTimes(1);
    expect(submitSignedIntentPage).toHaveBeenCalledWith({
      page: { records: [] },
      receivedAt: 1_000,
    });
  });

  it("coalesces concurrent exact replay and rejects changed identity reuse", async () => {
    const result = new Deferred<unknown>();
    const submitSignedIntentPage = vi.fn(() => result.promise);
    const processor = createLibraryServiceLocalActorProcessorV1(
      { submitSignedIntentPage },
      { nowMs: () => 1_000 },
    );
    const first = processor.executeFrame(request());
    const replay = processor.executeFrame(request());
    expect(submitSignedIntentPage).toHaveBeenCalledTimes(1);
    result.resolve({ receipt: "accepted" });
    expect(await replay).toEqual(await first);
    expect(
      decoded(
        await processor.executeFrame(
          request("1".repeat(64), {
            page: { records: [{ changed: true }] },
          }),
        ),
      ),
    ).toMatchObject({ errorCode: "request_conflict", ok: false });
    expect(submitSignedIntentPage).toHaveBeenCalledTimes(1);
  });

  it.each([
    [Buffer.from("{"), "frame_invalid", null],
    [
      Buffer.from(
        JSON.stringify({
          method: "raw_sql_v1",
          payload: {},
          protocolVersion: 1,
          requestId: "2".repeat(64),
        }),
      ),
      "method_unknown",
      "2".repeat(64),
    ],
    [
      request("3".repeat(64), { page: {}, receivedAt: -1 }),
      "frame_invalid",
      "3".repeat(64),
    ],
  ])("rejects a closed invalid frame", async (frame, code, requestId) => {
    const backend: LibraryServiceLocalActorBackendV1 = {
      submitSignedIntentPage: vi.fn(),
    };
    const processor = createLibraryServiceLocalActorProcessorV1(backend, {
      nowMs: () => 1_000,
    });
    expect(decoded(await processor.executeFrame(frame))).toMatchObject({
      errorCode: code,
      ok: false,
      protocolVersion: 1,
      requestId,
    });
    expect(backend.submitSignedIntentPage).not.toHaveBeenCalled();
  });

  it("enforces the generated rolling request rate while exact replay remains available", async () => {
    let now = 1_000;
    const submitSignedIntentPage = vi.fn(async () => ({ accepted: true }));
    const processor = createLibraryServiceLocalActorProcessorV1(
      { submitSignedIntentPage },
      { nowMs: () => now },
    );
    for (let index = 0; index < 120; index += 1) {
      const response = decoded(
        await processor.executeFrame(
          request(index.toString(16).padStart(64, "0")),
        ),
      );
      expect(response.ok).toBe(true);
    }
    expect(
      decoded(await processor.executeFrame(request("f".repeat(64)))),
    ).toMatchObject({ errorCode: "busy", ok: false });
    expect(
      decoded(await processor.executeFrame(request("0".repeat(64)))),
    ).toMatchObject({
      ok: true,
    });
    now += 60_001;
    expect(
      decoded(await processor.executeFrame(request("e".repeat(64)))),
    ).toMatchObject({ ok: true });
  });

  it("refuses new work when every bounded replay slot is still in flight", async () => {
    let now = 1_000;
    const submitSignedIntentPage = vi.fn(() => new Promise(() => undefined));
    const processor = createLibraryServiceLocalActorProcessorV1(
      { submitSignedIntentPage },
      { nowMs: () => now },
    );
    for (let index = 0; index < 256; index += 1) {
      if (index > 0 && index % 120 === 0) now += 60_001;
      void processor.executeFrame(
        request(index.toString(16).padStart(64, "0")),
      );
    }

    expect(submitSignedIntentPage).toHaveBeenCalledTimes(256);
    expect(
      decoded(await processor.executeFrame(request("1".repeat(63) + "0"))),
    ).toMatchObject({ errorCode: "busy", ok: false });
    expect(submitSignedIntentPage).toHaveBeenCalledTimes(256);
  });

  it("converts backend detail and oversized success into closed failures", async () => {
    const failures = [
      vi.fn(async () => {
        throw new Error("secret native detail");
      }),
      vi.fn(async () => ({ value: "x".repeat(1_048_576) })),
    ];
    for (const submitSignedIntentPage of failures) {
      const processor = createLibraryServiceLocalActorProcessorV1(
        { submitSignedIntentPage },
        { nowMs: () => 1_000 },
      );
      const response = decoded(await processor.executeFrame(request()));
      expect(response.ok).toBe(false);
      expect(["request_failed", "response_invalid"]).toContain(
        response.errorCode,
      );
      expect(JSON.stringify(response)).not.toContain("secret native detail");
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createGalaxyLabFixture } from "./scene-fixture.js";
import {
  loadGalaxyLabFixture,
  type GalaxyLabFixtureWorkerPort,
} from "./scene-fixture-loader.js";
import {
  compactGalaxyLabFixtureMetadata,
  galaxyLabFixtureWorkerReceipt,
  type GalaxyLabFixtureWorkerRequest,
  type GalaxyLabFixtureWorkerResponse,
} from "./scene-fixture-worker-protocol.js";

class FixtureWorkerStub implements GalaxyLabFixtureWorkerPort {
  onmessage:
    ((event: MessageEvent<GalaxyLabFixtureWorkerResponse>) => void) | null =
    null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  request: GalaxyLabFixtureWorkerRequest | null = null;
  terminated = false;
  postError: Error | null = null;

  postMessage(message: GalaxyLabFixtureWorkerRequest): void {
    if (this.postError) throw this.postError;
    this.request = message;
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: GalaxyLabFixtureWorkerResponse): void {
    this.onmessage?.({
      data: response,
    } as MessageEvent<GalaxyLabFixtureWorkerResponse>);
  }
}

describe("Friends Galaxy fixture worker loader", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves the transferred fixture and closes its one-shot worker", async () => {
    const worker = new FixtureWorkerStub();
    const pending = loadGalaxyLabFixture(worker, {
      personCount: 20,
      accountCount: 80,
      backgroundStarCount: 200,
    });
    const fixture = compactGalaxyLabFixtureMetadata(
      createGalaxyLabFixture({
        personCount: 20,
        accountCount: 80,
        backgroundStarCount: 200,
      }),
    );
    worker.respond({
      kind: "ready",
      requestId: worker.request!.requestId,
      fixture,
      receipt: galaxyLabFixtureWorkerReceipt(fixture, 21),
    });

    const result = await pending;
    expect(worker.request).toMatchObject({ kind: "build", requestId: 1 });
    expect(result.fixture.scene.nodeIds).toHaveLength(100);
    expect(result.receipt.transferableBufferCount).toBe(21);
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it("rejects an explicit worker failure without rebuilding on the caller", async () => {
    const worker = new FixtureWorkerStub();
    const pending = loadGalaxyLabFixture(worker, {
      personCount: 20,
      accountCount: 80,
      backgroundStarCount: 200,
    });
    worker.respond({
      kind: "error",
      requestId: worker.request!.requestId,
      message: "fixture compilation failed",
    });

    await expect(pending).rejects.toThrow("fixture compilation failed");
    expect(worker.terminated).toBe(true);
  });

  it("settles and closes the worker when request dispatch fails", async () => {
    const worker = new FixtureWorkerStub();
    worker.postError = new Error("worker request failed");

    await expect(
      loadGalaxyLabFixture(worker, {
        personCount: 20,
        accountCount: 80,
        backgroundStarCount: 200,
      }),
    ).rejects.toThrow("worker request failed");
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it("times out and closes a silent worker without caller-side compilation", async () => {
    vi.useFakeTimers();
    const worker = new FixtureWorkerStub();
    const pending = loadGalaxyLabFixture(
      worker,
      {
        personCount: 20,
        accountCount: 80,
        backgroundStarCount: 200,
      },
      25,
    );
    const rejection = expect(pending).rejects.toThrow(
      "Friends Galaxy worker timed out before producing a scene.",
    );

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });
});

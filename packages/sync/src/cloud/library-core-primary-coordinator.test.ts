import { describe, expect, it, vi } from "vitest";

import {
  createLibraryCorePrimaryCoordinatorV1,
  type LibraryCorePrimaryCoordinatorDiagnosticV1,
  type LibraryCorePrimaryDurableStateV1,
} from "./library-core-primary-coordinator.js";

type TestResult = Readonly<{
  status: "current" | "ownership_required" | "published";
  revision: number;
}>;

class FakeScheduler {
  private nextId = 1;
  readonly tasks = new Map<
    number,
    {
      readonly callback: () => void | Promise<void>;
      readonly delayMs: number;
    }
  >();
  lastCallbackResult: unknown = null;

  schedule(callback: () => void | Promise<void>, delayMs: number): number {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, { callback, delayMs });
    return id;
  }

  cancel(id: number): void {
    this.tasks.delete(id);
  }

  async runNext(): Promise<void> {
    const next = this.tasks.entries().next().value as
      | readonly [
          number,
          {
            readonly callback: () => void | Promise<void>;
            readonly delayMs: number;
          },
        ]
      | undefined;
    if (next === undefined) throw new Error("no scheduled task");
    this.tasks.delete(next[0]);
    this.lastCallbackResult = next[1].callback();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function activeState(
  localRevision: number,
  lastPublishedRevision: number | null,
): LibraryCorePrimaryDurableStateV1 {
  return { active: true, localRevision, lastPublishedRevision };
}

describe("Library Core Primary coordinator", () => {
  it("publishes immediately, then uses refreshed credentials for a changed local revision", async () => {
    const scheduler = new FakeScheduler();
    const events: LibraryCorePrimaryCoordinatorDiagnosticV1[] = [];
    const googleFetch = vi.fn<typeof fetch>();
    let nowMs = 1_000;
    let durableState = activeState(7, 7);
    const resolveAccessToken = vi.fn(async () => "refreshed-token");
    const publication = vi.fn(
      async ({
        accessToken,
        googleFetch: injectedFetch,
        signal,
      }: {
        readonly accessToken: string;
        readonly googleFetch?: typeof fetch;
        readonly signal: AbortSignal;
      }): Promise<TestResult> => {
        expect(injectedFetch).toBe(googleFetch);
        expect(signal.aborted).toBe(false);
        return {
          status: accessToken === "initial-token" ? "published" : "current",
          revision: durableState.localRevision,
        };
      },
    );
    const coordinator = createLibraryCorePrimaryCoordinatorV1({
      authority: { assertPrimary: vi.fn(), isPrimary: () => true },
      durableState: { read: async () => durableState },
      credentials: {
        initialAccessToken: "initial-token",
        resolveAccessToken,
      },
      clock: { nowMs: () => nowMs },
      scheduler,
      fetch: { googleFetch },
      diagnostics: { record: (event) => events.push(event) },
      publication: { publish: publication },
    });

    await expect(coordinator.start()).resolves.toEqual({
      status: "published",
      revision: 7,
    });
    expect(scheduler.tasks.values().next().value?.delayMs).toBe(15_000);

    nowMs += 15_000;
    await scheduler.runNext();
    expect(publication).toHaveBeenCalledTimes(1);
    expect(resolveAccessToken).not.toHaveBeenCalled();

    durableState = activeState(8, 7);
    nowMs += 15_000;
    await scheduler.runNext();

    expect(resolveAccessToken).toHaveBeenCalledTimes(1);
    expect(publication).toHaveBeenCalledTimes(2);
    expect(publication.mock.calls[1]?.[0].accessToken).toBe("refreshed-token");
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "publication_started",
        reason: "local_revision",
      }),
    );
  });

  it("refreshes inbound actor work every 60 seconds without a local revision change", async () => {
    const scheduler = new FakeScheduler();
    let nowMs = 5_000;
    const publication = vi.fn(async (): Promise<TestResult> => ({
      status: "current",
      revision: 12,
    }));
    const events: LibraryCorePrimaryCoordinatorDiagnosticV1[] = [];
    const coordinator = createLibraryCorePrimaryCoordinatorV1({
      authority: { assertPrimary() {}, isPrimary: () => true },
      durableState: { read: async () => activeState(12, 12) },
      credentials: {
        initialAccessToken: "initial",
        resolveAccessToken: async () => "refreshed",
      },
      clock: { nowMs: () => nowMs },
      scheduler,
      fetch: {},
      diagnostics: { record: (event) => events.push(event) },
      publication: { publish: publication },
    });

    await coordinator.start();
    for (let poll = 0; poll < 3; poll += 1) {
      nowMs += 15_000;
      await scheduler.runNext();
    }
    expect(publication).toHaveBeenCalledTimes(1);

    nowMs += 15_000;
    await scheduler.runNext();

    expect(publication).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "publication_completed",
        reason: "inbound_refresh",
      }),
    );
  });

  it("stops without scheduling when cloud ownership belongs to another writer", async () => {
    const scheduler = new FakeScheduler();
    const events: LibraryCorePrimaryCoordinatorDiagnosticV1[] = [];
    const publicationSignals: AbortSignal[] = [];
    const coordinator = createLibraryCorePrimaryCoordinatorV1({
      authority: { assertPrimary() {}, isPrimary: () => true },
      durableState: { read: async () => activeState(2, 1) },
      credentials: {
        initialAccessToken: "initial",
        resolveAccessToken: async () => "refreshed",
      },
      clock: { nowMs: () => 10 },
      scheduler,
      fetch: {},
      diagnostics: { record: (event) => events.push(event) },
      publication: {
        async publish({ signal }): Promise<TestResult> {
          publicationSignals.push(signal);
          return { status: "ownership_required", revision: 2 };
        },
      },
    });

    await expect(coordinator.start()).resolves.toEqual({
      status: "ownership_required",
      revision: 2,
    });

    expect(scheduler.tasks.size).toBe(0);
    expect(publicationSignals[0]?.aborted).toBe(true);
    expect(events.at(-1)).toMatchObject({
      kind: "stopped",
      reason: "ownership_required",
    });
  });

  it("stops before reading durable state when the host is no longer Primary", async () => {
    const scheduler = new FakeScheduler();
    let primary = true;
    const read = vi.fn(async () => activeState(4, 4));
    const publication = vi.fn(async (): Promise<TestResult> => ({
      status: "current",
      revision: 4,
    }));
    const coordinator = createLibraryCorePrimaryCoordinatorV1({
      authority: { assertPrimary() {}, isPrimary: () => primary },
      durableState: { read },
      credentials: {
        initialAccessToken: "initial",
        resolveAccessToken: async () => "refreshed",
      },
      clock: { nowMs: () => 10 },
      scheduler,
      fetch: {},
      diagnostics: { record() {} },
      publication: { publish: publication },
    });

    await coordinator.start();
    primary = false;
    await scheduler.runNext();

    expect(read).not.toHaveBeenCalled();
    expect(publication).toHaveBeenCalledTimes(1);
    expect(scheduler.tasks.size).toBe(0);
  });

  it("diagnoses a failed poll and schedules the next bounded retry", async () => {
    const scheduler = new FakeScheduler();
    const failure = new Error("Bearer secret-credential-value");
    const events: LibraryCorePrimaryCoordinatorDiagnosticV1[] = [];
    let call = 0;
    const publication = vi.fn(async (): Promise<TestResult> => {
      call += 1;
      if (call === 2) throw failure;
      return { status: "published", revision: call };
    });
    const coordinator = createLibraryCorePrimaryCoordinatorV1({
      authority: { assertPrimary() {}, isPrimary: () => true },
      durableState: { read: async () => activeState(2, 1) },
      credentials: {
        initialAccessToken: "initial",
        resolveAccessToken: async () => "refreshed",
      },
      clock: { nowMs: () => 10 },
      scheduler,
      fetch: {},
      diagnostics: { record: (event) => events.push(event) },
      publication: { publish: publication },
    });

    await coordinator.start();
    await scheduler.runNext();

    expect(scheduler.lastCallbackResult).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      kind: "failed",
      errorClass: "scheduled_poll_failed",
      safeDetail: "A scheduled Library Core Primary coordination pass failed.",
    });
    expect(JSON.stringify(events)).not.toContain(failure.message);
    expect(scheduler.tasks.size).toBe(1);

    await scheduler.runNext();
    expect(publication).toHaveBeenCalledTimes(3);
  });

  it("aborts an in-flight publication and does not schedule after manual stop", async () => {
    const scheduler = new FakeScheduler();
    let settlePublication: (result: TestResult) => void = () => {
      throw new Error("publication did not start");
    };
    const pendingPublication = new Promise<TestResult>((resolve) => {
      settlePublication = resolve;
    });
    const publicationSignals: AbortSignal[] = [];
    const coordinator = createLibraryCorePrimaryCoordinatorV1({
      authority: { assertPrimary() {}, isPrimary: () => true },
      durableState: { read: async () => activeState(1, 1) },
      credentials: {
        initialAccessToken: "initial",
        resolveAccessToken: async () => "refreshed",
      },
      clock: { nowMs: () => 10 },
      scheduler,
      fetch: {},
      diagnostics: { record() {} },
      publication: {
        publish({ signal }) {
          publicationSignals.push(signal);
          return pendingPublication;
        },
      },
    });

    const starting = coordinator.start();
    coordinator.stop();
    expect(publicationSignals[0]?.aborted).toBe(true);
    settlePublication({ status: "current", revision: 1 });

    await expect(starting).resolves.toEqual({
      status: "current",
      revision: 1,
    });
    expect(scheduler.tasks.size).toBe(0);
  });
});

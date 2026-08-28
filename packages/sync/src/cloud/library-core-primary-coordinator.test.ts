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
  it("publishes immediately, then reports a changed local revision to the host", async () => {
    const scheduler = new FakeScheduler();
    const events: LibraryCorePrimaryCoordinatorDiagnosticV1[] = [];
    let nowMs = 1_000;
    let durableState = activeState(7, 7);
    const publication = vi.fn(
      async ({
        reason,
        signal,
      }: {
        readonly reason: "initial" | "local_revision" | "inbound_refresh";
        readonly signal: AbortSignal;
      }): Promise<TestResult> => {
        expect(signal.aborted).toBe(false);
        return {
          status: reason === "initial" ? "published" : "current",
          revision: durableState.localRevision,
        };
      },
    );
    const coordinator = createLibraryCorePrimaryCoordinatorV1({
      authority: { assertPrimary: vi.fn() },
      durableState: { read: async () => durableState },
      clock: { nowMs: () => nowMs },
      scheduler,
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

    durableState = activeState(8, 7);
    nowMs += 15_000;
    await scheduler.runNext();

    expect(publication).toHaveBeenCalledTimes(2);
    expect(publication.mock.calls[1]?.[0].reason).toBe("local_revision");
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
      authority: { assertPrimary() {} },
      durableState: { read: async () => activeState(12, 12) },
      clock: { nowMs: () => nowMs },
      scheduler,
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
      authority: { assertPrimary() {} },
      durableState: { read: async () => activeState(2, 1) },
      clock: { nowMs: () => 10 },
      scheduler,
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

  it("stops when durable state reports that the host is no longer Primary", async () => {
    const scheduler = new FakeScheduler();
    let primary = true;
    const read = vi.fn(async () =>
      primary
        ? activeState(4, 4)
        : { active: false, localRevision: 0, lastPublishedRevision: null },
    );
    const publication = vi.fn(async (): Promise<TestResult> => ({
      status: "current",
      revision: 4,
    }));
    const coordinator = createLibraryCorePrimaryCoordinatorV1({
      authority: { assertPrimary() {} },
      durableState: { read },
      clock: { nowMs: () => 10 },
      scheduler,
      diagnostics: { record() {} },
      publication: { publish: publication },
    });

    await coordinator.start();
    primary = false;
    await scheduler.runNext();

    expect(read).toHaveBeenCalledTimes(1);
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
      authority: { assertPrimary() {} },
      durableState: { read: async () => activeState(2, 1) },
      clock: { nowMs: () => 10 },
      scheduler,
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
      authority: { assertPrimary() {} },
      durableState: { read: async () => activeState(1, 1) },
      clock: { nowMs: () => 10 },
      scheduler,
      diagnostics: { record() {} },
      publication: {
        publish({ signal }) {
          publicationSignals.push(signal);
          return pendingPublication;
        },
      },
    });

    const starting = coordinator.start();
    await Promise.resolve();
    coordinator.stop();
    expect(publicationSignals[0]?.aborted).toBe(true);
    settlePublication({ status: "current", revision: 1 });

    await expect(starting).resolves.toEqual({
      status: "current",
      revision: 1,
    });
    expect(scheduler.tasks.size).toBe(0);
  });

  it("cannot be resurrected after stop during asynchronous authority assertion", async () => {
    const scheduler = new FakeScheduler();
    let settleAuthority: () => void = () => {
      throw new Error("authority assertion did not start");
    };
    const authority = new Promise<void>((resolve) => {
      settleAuthority = resolve;
    });
    const publication = vi.fn(async (): Promise<TestResult> => ({
      status: "current",
      revision: 1,
    }));
    const coordinator = createLibraryCorePrimaryCoordinatorV1({
      authority: { assertPrimary: () => authority },
      durableState: { read: async () => activeState(1, 1) },
      clock: { nowMs: () => 10 },
      scheduler,
      diagnostics: { record() {} },
      publication: { publish: publication },
    });

    const starting = coordinator.start();
    await Promise.resolve();
    coordinator.stop();
    settleAuthority();

    await expect(starting).rejects.toThrow(
      "stopped during authority assertion",
    );
    expect(publication).not.toHaveBeenCalled();
    expect(scheduler.tasks.size).toBe(0);
  });
});

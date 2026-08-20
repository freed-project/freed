import type { GoogleDriveFetch } from "./library-core-google-drive-adapter.js";

const DEFAULT_LOCAL_REVISION_POLL_MS = 15_000;
const DEFAULT_INBOUND_ACTOR_POLL_MS = 60_000;
const MAX_DIAGNOSTIC_DETAIL_BYTES = 160;

export interface LibraryCorePrimaryAuthorityPortV1 {
  assertPrimary(): void;
  isPrimary(): boolean;
}

export interface LibraryCorePrimaryDurableStateV1 {
  readonly active: boolean;
  readonly localRevision: number;
  readonly lastPublishedRevision: number | null;
}

export interface LibraryCorePrimaryDurableStatePortV1 {
  read(): Promise<LibraryCorePrimaryDurableStateV1 | null>;
}

export interface LibraryCorePrimaryCredentialPortV1 {
  readonly initialAccessToken: string;
  resolveAccessToken(): Promise<string>;
}

export interface LibraryCorePrimaryClockPortV1 {
  nowMs(): number;
}

export interface LibraryCorePrimarySchedulerPortV1<TimerHandle> {
  schedule(callback: () => void | Promise<void>, delayMs: number): TimerHandle;
  cancel(handle: TimerHandle): void;
}

export interface LibraryCorePrimaryFetchPortV1 {
  readonly googleFetch?: GoogleDriveFetch;
}

export type LibraryCorePrimaryCoordinatorDiagnosticV1 =
  | {
      readonly kind: "started";
      readonly atMs: number;
    }
  | {
      readonly kind: "publication_started";
      readonly atMs: number;
      readonly reason: "initial" | "local_revision" | "inbound_refresh";
    }
  | {
      readonly kind: "publication_completed";
      readonly atMs: number;
      readonly reason: "initial" | "local_revision" | "inbound_refresh";
      readonly status: string;
    }
  | {
      readonly kind: "failed";
      readonly atMs: number;
      readonly errorClass:
        | "initial_publication_failed"
        | "scheduled_poll_failed";
      readonly safeDetail: string;
    }
  | {
      readonly kind: "stopped";
      readonly atMs: number;
      readonly reason: "authority_changed" | "manual" | "ownership_required";
    };

export interface LibraryCorePrimaryDiagnosticsPortV1 {
  record(event: LibraryCorePrimaryCoordinatorDiagnosticV1): void;
}

export interface LibraryCorePrimaryPublicationResultV1 {
  readonly status: string;
}

export interface LibraryCorePrimaryPublicationPortV1<
  Result extends LibraryCorePrimaryPublicationResultV1,
> {
  publish(input: {
    readonly accessToken: string;
    readonly googleFetch?: GoogleDriveFetch;
    readonly signal: AbortSignal;
  }): Promise<Result>;
}

export interface LibraryCorePrimaryCoordinatorOptionsV1<
  Result extends LibraryCorePrimaryPublicationResultV1,
  TimerHandle,
> {
  readonly authority: LibraryCorePrimaryAuthorityPortV1;
  readonly durableState: LibraryCorePrimaryDurableStatePortV1;
  readonly credentials: LibraryCorePrimaryCredentialPortV1;
  readonly clock: LibraryCorePrimaryClockPortV1;
  readonly scheduler: LibraryCorePrimarySchedulerPortV1<TimerHandle>;
  readonly fetch: LibraryCorePrimaryFetchPortV1;
  readonly diagnostics: LibraryCorePrimaryDiagnosticsPortV1;
  readonly publication: LibraryCorePrimaryPublicationPortV1<Result>;
  readonly localRevisionPollMs?: number;
  readonly inboundActorPollMs?: number;
}

export interface LibraryCorePrimaryCoordinatorV1<
  Result extends LibraryCorePrimaryPublicationResultV1,
> {
  start(): Promise<Result>;
  stop(): void;
}

function requirePositiveInterval(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireClockValue(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Library Core Primary clock returned an invalid time");
  }
  return value;
}

function requireDurableState(
  value: LibraryCorePrimaryDurableStateV1 | null,
): LibraryCorePrimaryDurableStateV1 | null {
  if (value === null) return null;
  if (
    typeof value.active !== "boolean" ||
    !Number.isSafeInteger(value.localRevision) ||
    value.localRevision < 0 ||
    (value.lastPublishedRevision !== null &&
      (!Number.isSafeInteger(value.lastPublishedRevision) ||
        value.lastPublishedRevision < 0))
  ) {
    throw new TypeError(
      "Library Core Primary durable state returned an invalid revision",
    );
  }
  return value;
}

function boundedDiagnosticDetail(value: string): string {
  return value
    .replace(/[^\u0020-\u007e]+/gu, " ")
    .trim()
    .slice(0, MAX_DIAGNOSTIC_DETAIL_BYTES);
}

function boundedDiagnosticStatus(value: string): string {
  return /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : "unknown";
}

/**
 * Coordinate one Primary Library publisher without owning platform state.
 *
 * The host injects every capability that differs between Freed Desktop and a
 * future headless authority. The coordinator never opens SQLite, reads a
 * credential store, creates a network client, or performs provider capture.
 */
export function createLibraryCorePrimaryCoordinatorV1<
  Result extends LibraryCorePrimaryPublicationResultV1,
  TimerHandle,
>(
  options: LibraryCorePrimaryCoordinatorOptionsV1<Result, TimerHandle>,
): LibraryCorePrimaryCoordinatorV1<Result> {
  const localRevisionPollMs = requirePositiveInterval(
    options.localRevisionPollMs ?? DEFAULT_LOCAL_REVISION_POLL_MS,
    "localRevisionPollMs",
  );
  const inboundActorPollMs = requirePositiveInterval(
    options.inboundActorPollMs ?? DEFAULT_INBOUND_ACTOR_POLL_MS,
    "inboundActorPollMs",
  );
  const abortController = new AbortController();
  let lifecycle: "idle" | "running" | "stopped" = "idle";
  let timer: TimerHandle | null = null;
  let lastInboundActorPollAt = 0;
  let lastObservedAtMs = 0;

  const now = (): number => {
    lastObservedAtMs = requireClockValue(options.clock.nowMs());
    return lastObservedAtMs;
  };
  const diagnosticAtMs = (): number => {
    try {
      return now();
    } catch {
      return lastObservedAtMs;
    }
  };
  const diagnose = (event: LibraryCorePrimaryCoordinatorDiagnosticV1): void => {
    try {
      options.diagnostics.record(event);
    } catch {
      // Diagnostics are evidence only. They cannot own publication progress.
    }
  };
  const stop = (
    reason: "authority_changed" | "manual" | "ownership_required",
  ): void => {
    if (lifecycle === "stopped") return;
    lifecycle = "stopped";
    abortController.abort();
    if (timer !== null) {
      options.scheduler.cancel(timer);
      timer = null;
    }
    diagnose({ kind: "stopped", atMs: diagnosticAtMs(), reason });
  };
  const diagnoseFailure = (
    errorClass:
      | "initial_publication_failed"
      | "scheduled_poll_failed",
  ): void => {
    diagnose({
      kind: "failed",
      atMs: diagnosticAtMs(),
      errorClass,
      safeDetail: boundedDiagnosticDetail(
        errorClass === "initial_publication_failed"
          ? "The initial Library Core Primary publication failed."
          : "A scheduled Library Core Primary coordination pass failed.",
      ),
    });
  };
  const publish = async (
    accessToken: string,
    reason: "initial" | "local_revision" | "inbound_refresh",
  ): Promise<Result> => {
    diagnose({ kind: "publication_started", atMs: now(), reason });
    const result = await options.publication.publish({
      accessToken,
      googleFetch: options.fetch.googleFetch,
      signal: abortController.signal,
    });
    diagnose({
      kind: "publication_completed",
      atMs: now(),
      reason,
      status: boundedDiagnosticStatus(result.status),
    });
    return result;
  };
  const scheduleNext = (): void => {
    if (lifecycle !== "running" || abortController.signal.aborted) return;
    timer = options.scheduler.schedule(() => {
      timer = null;
      void runScheduledPoll();
    }, localRevisionPollMs);
  };
  const poll = async (): Promise<void> => {
    if (lifecycle !== "running" || abortController.signal.aborted) return;
    if (!options.authority.isPrimary()) {
      stop("authority_changed");
      return;
    }
    try {
      const durableState = requireDurableState(
        await options.durableState.read(),
      );
      const polledAt = now();
      if (durableState?.active !== true) return;
      const localRevisionChanged =
        durableState.lastPublishedRevision !== durableState.localRevision;
      const inboundRefreshDue =
        polledAt - lastInboundActorPollAt >= inboundActorPollMs;
      if (!localRevisionChanged && !inboundRefreshDue) return;
      lastInboundActorPollAt = polledAt;
      const result = await publish(
        await options.credentials.resolveAccessToken(),
        localRevisionChanged ? "local_revision" : "inbound_refresh",
      );
      if (result.status === "ownership_required") {
        stop("ownership_required");
      }
    } finally {
      scheduleNext();
    }
  };
  const runScheduledPoll = async (): Promise<void> => {
    try {
      await poll();
    } catch {
      diagnoseFailure("scheduled_poll_failed");
    }
  };

  return Object.freeze({
    async start(): Promise<Result> {
      if (lifecycle !== "idle") {
        throw new Error("Library Core Primary coordinator already started");
      }
      options.authority.assertPrimary();
      lifecycle = "running";
      diagnose({ kind: "started", atMs: now() });
      let initial: Result;
      try {
        initial = await publish(
          options.credentials.initialAccessToken,
          "initial",
        );
      } catch (error) {
        diagnoseFailure("initial_publication_failed");
        throw error;
      }
      if (initial.status === "ownership_required") {
        stop("ownership_required");
        return initial;
      }
      if (lifecycle === "running" && !abortController.signal.aborted) {
        lastInboundActorPollAt = now();
        scheduleNext();
      }
      return initial;
    },
    stop(): void {
      stop("manual");
    },
  });
}

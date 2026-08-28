import { createHash } from "node:crypto";

import {
  LIBRARY_CORE_LOCAL_ACTOR_ERROR_CODES,
  LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_REPLAY_ENTRIES,
  LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_REQUEST_FRAME_BYTES,
  LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_REQUESTS_PER_MINUTE,
  LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_RESPONSE_FRAME_BYTES,
  LIBRARY_CORE_LOCAL_ACTOR_METHODS,
  LIBRARY_CORE_LOCAL_ACTOR_PROTOCOL_VERSION,
  type LibraryCoreLocalActorErrorCode,
  type LibraryCoreLocalActorMethod,
} from "./library-core-command-contract.generated.js";
import type { LibraryServiceBoundPath } from "./contracts.js";

const REQUEST_ID = /^[a-f0-9]{64}$/u;
const METHODS = new Set<string>(LIBRARY_CORE_LOCAL_ACTOR_METHODS);
const ERRORS = new Set<string>(LIBRARY_CORE_LOCAL_ACTOR_ERROR_CODES);
const RATE_WINDOW_MS = 60_000;

export interface LibraryServiceLocalActorBackendV1 {
  executeSignedQuery(payload: {
    readonly canonicalAgentQueryJson: string;
  }): Promise<unknown>;
  submitSignedIntentPage(payload: {
    readonly page: Readonly<Record<string, unknown>>;
    readonly receivedAt: number;
  }): Promise<unknown>;
}

export interface LibraryServiceLocalActorClockV1 {
  nowMs(): number;
}

export interface LibraryServiceLocalActorProcessorV1 {
  executeFrame(frame: Uint8Array): Promise<Uint8Array>;
}

export interface LibraryServiceLocalActorListenerV1 {
  readonly endpoint: string;
  readonly failure: Promise<never>;
  stop(): Promise<void>;
}

export interface LibraryServiceLocalActorIngressPortV1 {
  start(input: {
    readonly stateRoot: LibraryServiceBoundPath;
    readonly expectedUserId: number;
    readonly processor: LibraryServiceLocalActorProcessorV1;
  }): Promise<LibraryServiceLocalActorListenerV1>;
}

type ParsedRequest =
  | {
      readonly method: "execute_signed_query_v1";
      readonly payload: { readonly canonicalAgentQueryJson: string };
      readonly requestId: string;
    }
  | {
      readonly method: "submit_signed_intent_page_v1";
      readonly payload: {
        readonly page: Readonly<Record<string, unknown>>;
      };
      readonly requestId: string;
    };

interface ReplayEntry {
  readonly digest: string;
  response: Promise<Uint8Array>;
  complete: boolean;
}

function isClosedObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return (
    keys.length === sorted.length &&
    keys.every((key, index) => key === sorted[index])
  );
}

function parseRequest(frame: Uint8Array): ParsedRequest {
  if (
    !(frame instanceof Uint8Array) ||
    frame.byteLength === 0 ||
    frame.byteLength > LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_REQUEST_FRAME_BYTES
  ) {
    throw new TypeError("frame_invalid");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame));
  } catch {
    throw new TypeError("frame_invalid");
  }
  if (
    !isClosedObject(value) ||
    !hasExactKeys(value, [
      "method",
      "payload",
      "protocolVersion",
      "requestId",
    ]) ||
    value.protocolVersion !== LIBRARY_CORE_LOCAL_ACTOR_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    !REQUEST_ID.test(value.requestId) ||
    typeof value.method !== "string"
  ) {
    throw new TypeError("frame_invalid");
  }
  if (!METHODS.has(value.method)) {
    throw Object.assign(new TypeError("method_unknown"), {
      requestId: value.requestId,
    });
  }
  if (!isClosedObject(value.payload)) {
    throw Object.assign(new TypeError("frame_invalid"), {
      requestId: value.requestId,
    });
  }
  if (value.method === "execute_signed_query_v1") {
    if (
      !hasExactKeys(value.payload, ["canonicalAgentQueryJson"]) ||
      typeof value.payload.canonicalAgentQueryJson !== "string" ||
      value.payload.canonicalAgentQueryJson.length === 0
    ) {
      throw Object.assign(new TypeError("frame_invalid"), {
        requestId: value.requestId,
      });
    }
    return {
      method: value.method,
      payload: {
        canonicalAgentQueryJson: value.payload.canonicalAgentQueryJson,
      },
      requestId: value.requestId,
    };
  }
  if (
    value.method !== "submit_signed_intent_page_v1" ||
    !hasExactKeys(value.payload, ["page"]) ||
    !isClosedObject(value.payload.page)
  ) {
    throw Object.assign(new TypeError("frame_invalid"), {
      requestId: value.requestId,
    });
  }
  return {
    method: value.method,
    payload: {
      page: value.payload.page,
    },
    requestId: value.requestId,
  };
}

function encodeResponse(
  requestId: string | null,
  value:
    | { readonly ok: true; readonly result: unknown }
    | {
        readonly errorCode: LibraryCoreLocalActorErrorCode;
        readonly ok: false;
      },
): Uint8Array {
  const bytes = Buffer.from(
    `${JSON.stringify({
      protocolVersion: LIBRARY_CORE_LOCAL_ACTOR_PROTOCOL_VERSION,
      requestId,
      ...value,
    })}\n`,
    "utf8",
  );
  if (
    bytes.byteLength > LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_RESPONSE_FRAME_BYTES
  ) {
    if (!value.ok || value.result === undefined) {
      throw new TypeError("response_invalid");
    }
    return encodeResponse(requestId, {
      errorCode: "response_invalid",
      ok: false,
    });
  }
  return bytes;
}

export function encodeLibraryServiceLocalActorFailureV1(
  errorCode: LibraryCoreLocalActorErrorCode,
  requestId: string | null = null,
): Uint8Array {
  return encodeResponse(requestId, { errorCode, ok: false });
}

function errorCode(error: unknown): LibraryCoreLocalActorErrorCode {
  const candidate =
    error instanceof Error && ERRORS.has(error.message)
      ? error.message
      : "request_failed";
  return candidate as LibraryCoreLocalActorErrorCode;
}

function requestIdFromError(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "requestId" in error &&
    typeof error.requestId === "string" &&
    REQUEST_ID.test(error.requestId)
  ) {
    return error.requestId;
  }
  return null;
}

export function createLibraryServiceLocalActorProcessorV1(
  backend: LibraryServiceLocalActorBackendV1,
  clock: LibraryServiceLocalActorClockV1,
): LibraryServiceLocalActorProcessorV1 {
  const replay = new Map<string, ReplayEntry>();
  const admittedAt: number[] = [];

  const trimReplay = (): void => {
    while (replay.size > LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_REPLAY_ENTRIES) {
      const oldest = replay.entries().next().value as
        [string, ReplayEntry] | undefined;
      if (oldest === undefined || !oldest[1].complete) return;
      replay.delete(oldest[0]);
    }
  };

  const reserveReplayEntry = (): boolean => {
    while (replay.size >= LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_REPLAY_ENTRIES) {
      let oldestCompleteId: string | null = null;
      for (const [requestId, entry] of replay) {
        if (!entry.complete) continue;
        oldestCompleteId = requestId;
        break;
      }
      if (oldestCompleteId === null) return false;
      replay.delete(oldestCompleteId);
    }
    return true;
  };

  return Object.freeze({
    async executeFrame(frame: Uint8Array): Promise<Uint8Array> {
      let request: ParsedRequest;
      try {
        request = parseRequest(frame);
      } catch (error) {
        return encodeResponse(requestIdFromError(error), {
          errorCode: errorCode(error),
          ok: false,
        });
      }
      const digest = createHash("sha256").update(frame).digest("hex");
      const previous = replay.get(request.requestId);
      if (previous !== undefined) {
        if (previous.digest !== digest) {
          return encodeResponse(request.requestId, {
            errorCode: "request_conflict",
            ok: false,
          });
        }
        return previous.response;
      }

      const now = clock.nowMs();
      if (!Number.isSafeInteger(now) || now < 0) {
        return encodeResponse(request.requestId, {
          errorCode: "request_failed",
          ok: false,
        });
      }
      while (admittedAt.length > 0 && admittedAt[0]! <= now - RATE_WINDOW_MS) {
        admittedAt.shift();
      }
      if (
        admittedAt.length >=
        LIBRARY_CORE_LOCAL_ACTOR_MAXIMUM_REQUESTS_PER_MINUTE
      ) {
        return encodeResponse(request.requestId, {
          errorCode: "busy",
          ok: false,
        });
      }
      if (!reserveReplayEntry()) {
        return encodeResponse(request.requestId, {
          errorCode: "busy",
          ok: false,
        });
      }
      admittedAt.push(now);

      const entry: ReplayEntry = {
        complete: false,
        digest,
        response: Promise.resolve(new Uint8Array()),
      };
      const response = (async () => {
        try {
          const result =
            request.method === "execute_signed_query_v1"
              ? await backend.executeSignedQuery(request.payload)
              : await backend.submitSignedIntentPage({
                  page: request.payload.page,
                  receivedAt: now,
                });
          if (result === undefined) throw new TypeError("response_invalid");
          return encodeResponse(request.requestId, { ok: true, result });
        } catch (error) {
          return encodeResponse(request.requestId, {
            errorCode: errorCode(error),
            ok: false,
          });
        } finally {
          entry.complete = true;
          trimReplay();
        }
      })();
      entry.response = response;
      replay.set(request.requestId, entry);
      trimReplay();
      return response;
    },
  });
}

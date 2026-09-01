import {
  LibraryServiceFailure,
  type LibraryServiceEntropyPort,
  type LibraryServiceSidecarProcess,
} from "./contracts.js";
import {
  LIBRARY_CORE_NATIVE_COMMAND_ERROR_CODES,
  LIBRARY_CORE_NATIVE_COMMAND_IDS,
  LIBRARY_CORE_NATIVE_COMMAND_MAXIMUM_FRAME_BYTES,
  LIBRARY_CORE_NATIVE_COMMAND_PROTOCOL_VERSION,
  type LibraryCoreNativeCommandErrorCode,
  type LibraryCoreNativeCommandId,
} from "./library-core-command-contract.generated.js";

const LOWERCASE_HEX_64 = /^[a-f0-9]{64}$/u;
const COMMAND_IDS = new Set<string>(LIBRARY_CORE_NATIVE_COMMAND_IDS);
const COMMAND_ERROR_CODES = new Set<string>(
  LIBRARY_CORE_NATIVE_COMMAND_ERROR_CODES,
);

export class LibraryCoreNativeCommandFailure extends LibraryServiceFailure {
  readonly nativeCode: LibraryCoreNativeCommandErrorCode;

  constructor(nativeCode: LibraryCoreNativeCommandErrorCode) {
    super("command_channel_failed");
    this.name = "LibraryCoreNativeCommandFailure";
    this.nativeCode = nativeCode;
  }
}

export interface LibraryCoreNativeCommandClientV1 {
  execute(
    commandId: LibraryCoreNativeCommandId,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
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

function decodeResponse(bytes: Uint8Array): Record<string, unknown> {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > LIBRARY_CORE_NATIVE_COMMAND_MAXIMUM_FRAME_BYTES
  ) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  if (!isClosedObject(parsed)) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  return parsed;
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
}

export function createLibraryCoreNativeCommandClientV1(
  child: LibraryServiceSidecarProcess,
  entropy: LibraryServiceEntropyPort,
): LibraryCoreNativeCommandClientV1 {
  return Object.freeze({
    async execute(
      commandId: LibraryCoreNativeCommandId,
      payload: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
      if (!COMMAND_IDS.has(commandId) || !isClosedObject(payload)) {
        throw new LibraryServiceFailure("command_response_invalid");
      }
      const requestId = entropy.nonceHex(32);
      if (!LOWERCASE_HEX_64.test(requestId)) {
        throw new LibraryServiceFailure("filesystem_failure");
      }
      const request = Buffer.from(
        JSON.stringify({
          protocolVersion: LIBRARY_CORE_NATIVE_COMMAND_PROTOCOL_VERSION,
          requestId,
          commandId,
          payload,
        }),
        "utf8",
      );
      if (
        request.byteLength === 0 ||
        request.byteLength > LIBRARY_CORE_NATIVE_COMMAND_MAXIMUM_FRAME_BYTES
      ) {
        throw new LibraryServiceFailure("command_response_invalid");
      }

      let responseBytes: Uint8Array;
      try {
        responseBytes = await child.exchangeCommand(
          request,
          LIBRARY_CORE_NATIVE_COMMAND_MAXIMUM_FRAME_BYTES,
        );
      } catch {
        throw new LibraryServiceFailure("command_channel_failed");
      }
      const response = decodeResponse(responseBytes);
      if (
        response.protocolVersion !==
          LIBRARY_CORE_NATIVE_COMMAND_PROTOCOL_VERSION ||
        response.requestId !== requestId ||
        typeof response.ok !== "boolean"
      ) {
        throw new LibraryServiceFailure("command_response_invalid");
      }
      if (response.ok) {
        assertExactKeys(response, [
          "ok",
          "protocolVersion",
          "requestId",
          "result",
        ]);
        if (response.result === undefined) {
          throw new LibraryServiceFailure("command_response_invalid");
        }
        return response.result;
      }
      assertExactKeys(response, [
        "errorCode",
        "ok",
        "protocolVersion",
        "requestId",
      ]);
      if (
        typeof response.errorCode !== "string" ||
        !COMMAND_ERROR_CODES.has(response.errorCode)
      ) {
        throw new LibraryServiceFailure("command_response_invalid");
      }
      throw new LibraryCoreNativeCommandFailure(
        response.errorCode as LibraryCoreNativeCommandErrorCode,
      );
    },
  });
}

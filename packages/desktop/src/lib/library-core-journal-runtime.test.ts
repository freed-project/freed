import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const getLibraryCoreProjectionSource = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./automerge", () => ({ getLibraryCoreProjectionSource }));

const {
  establishLibraryCoreGenesisAuthority,
  openLibraryCoreJournalForStartup,
} = await import("./library-core-journal-runtime.js");

const SOURCE = {
  schemaVersion: 1,
  documentId: "freed-library-document-1",
  headsDigest: "a".repeat(64),
  headCount: 2,
  storageRevision: { generation: 7, saveRevision: 11 },
} as const;

const STATUS = {
  schemaVersion: 1,
  materializerIngestSequence: 0,
  actors: 0,
  operations: 0,
  readState: 0,
  unacknowledgedOutbox: 0,
} as const;

const AUTHORITY = {
  libraryId: "b".repeat(64),
  epoch: 1,
  epochId: "c".repeat(64),
  authorityKeyId: "d".repeat(64),
  actorId: "e".repeat(64),
  nextSequence: 1,
} as const;

describe("Library Core journal runtime client", () => {
  beforeEach(() => {
    invoke.mockReset();
    getLibraryCoreProjectionSource.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("sends the exact durable revision the worker reported", async () => {
    invoke.mockResolvedValue(AUTHORITY);

    await expect(establishLibraryCoreGenesisAuthority(SOURCE)).resolves.toEqual(
      AUTHORITY,
    );
    expect(invoke).toHaveBeenCalledWith(
      "establish_library_core_genesis_authority",
      {
        source: {
          documentId: "freed-library-document-1",
          headsDigest: "a".repeat(64),
          headCount: 2,
          storageGeneration: 7,
          storageSaveRevision: 11,
        },
      },
    );
  });

  it("opens the journal and then establishes authority against that revision", async () => {
    invoke.mockImplementation((command: string) =>
      command === "open_library_core_journal"
        ? Promise.resolve(STATUS)
        : Promise.resolve(AUTHORITY),
    );
    getLibraryCoreProjectionSource.mockResolvedValue(SOURCE);

    await expect(openLibraryCoreJournalForStartup()).resolves.toEqual(STATUS);

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "open_library_core_journal",
      "establish_library_core_genesis_authority",
    ]);
  });

  it("does not try to establish authority when the journal will not open", async () => {
    invoke.mockRejectedValue(new Error("journal refused to open"));

    await expect(openLibraryCoreJournalForStartup()).resolves.toBeNull();

    // Establishing against a database that never validated on open would be
    // writing authority into an unknown store.
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "open_library_core_journal",
    ]);
    expect(getLibraryCoreProjectionSource).not.toHaveBeenCalled();
  });

  it("still starts when the document has no durable revision yet", async () => {
    invoke.mockResolvedValue(STATUS);
    getLibraryCoreProjectionSource.mockRejectedValue(
      new Error("Document not initialized"),
    );

    // Startup must survive it: the next start tries again.
    await expect(openLibraryCoreJournalForStartup()).resolves.toEqual(STATUS);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "open_library_core_journal",
    ]);
  });

  it("still starts when establishing authority is refused", async () => {
    invoke.mockImplementation((command: string) =>
      command === "open_library_core_journal"
        ? Promise.resolve(STATUS)
        : Promise.reject(new Error("stale authority")),
    );
    getLibraryCoreProjectionSource.mockResolvedValue(SOURCE);

    await expect(openLibraryCoreJournalForStartup()).resolves.toEqual(STATUS);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const getLibraryCoreProjectionSource = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./automerge", () => ({ getLibraryCoreProjectionSource }));

const { openLibraryCoreJournalForStartup } = await import(
  "./library-core-journal-runtime.js"
);

const STATUS = {
  schemaVersion: 1,
  materializerIngestSequence: 0,
  actors: 0,
  operations: 0,
  readState: 0,
  unacknowledgedOutbox: 0,
} as const;

describe("Library Core journal runtime client", () => {
  beforeEach(() => {
    invoke.mockReset();
    getLibraryCoreProjectionSource.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  /// Startup opens a database and stops. It must not choose a creator, mint a
  /// key, create an epoch, or enroll an actor as a side effect of launching.
  it("opens the journal and establishes nothing else", async () => {
    invoke.mockResolvedValue(STATUS);

    await expect(openLibraryCoreJournalForStartup()).resolves.toEqual(STATUS);

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "open_library_core_journal",
    ]);
    // Reading the durable Automerge revision at startup only made sense as
    // input to choosing a creator, which startup must never do.
    expect(getLibraryCoreProjectionSource).not.toHaveBeenCalled();
  });

  it("still starts when the journal will not open", async () => {
    invoke.mockRejectedValue(new Error("journal refused to open"));

    await expect(openLibraryCoreJournalForStartup()).resolves.toBeNull();
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "open_library_core_journal",
    ]);
  });
});

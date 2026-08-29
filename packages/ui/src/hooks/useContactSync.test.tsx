/**
 * @vitest-environment jsdom
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  LEGACY_CONTACT_SYNC_STORAGE_KEY,
  type GoogleContact,
  type IdentitySuggestion,
} from "@freed/shared";
import type {
  LibraryCoreDeviceContactMutationExecutor,
  LibraryCoreDeviceContactMutationReceiptV1,
  LibraryCoreDeviceContactQueryExecutor,
  LibraryCoreDeviceContactStatusResponseV1,
} from "@freed/shared/library-core";
import { PlatformProvider, type PlatformConfig } from "../context/PlatformContext";
import { useBackgroundActivityStore } from "../lib/background-activity-store";
import { resetFactoryResetStateForTests } from "../lib/factory-reset";
import { useContactSync } from "./useContactSync";

type ContactSyncActions = ReturnType<typeof useContactSync>;

function ContactSyncHarness({ onReady }: { onReady: (actions: ContactSyncActions) => void }) {
  const actions = useContactSync();
  useEffect(() => onReady(actions), [actions, onReady]);
  return null;
}

function status(): LibraryCoreDeviceContactStatusResponseV1 {
  return {
    activeContactCount: 0,
    activeGenerationId: null,
    authStatus: "reconnect_required",
    createdFriendCount: 0,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSyncedAt: null,
    pendingSuggestionCount: 0,
    queryId: "device_contact_status_v1",
    revision: 0,
    schemaVersion: 1,
    syncStartedAt: null,
    syncStatus: "idle",
    syncToken: null,
    updatedAt: 0,
  };
}

function createContactRuntime() {
  let current = status();
  let buildingGenerationId: string | null = null;
  let contacts: GoogleContact[] = [];
  let suggestions: IdentitySuggestion[] = [];
  const receipt = (changed: boolean): LibraryCoreDeviceContactMutationReceiptV1 => ({
    activeGenerationId: current.activeGenerationId,
    changed,
    generationId: buildingGenerationId ?? current.activeGenerationId,
    matchedContactCount: suggestions.length,
    revision: current.revision,
    schemaVersion: 1,
    stagedContactCount: contacts.length,
  });
  const mutate = vi.fn(async (mutation) => {
    current = { ...current, revision: current.revision + 1 };
    switch (mutation.mutationKind) {
      case "device_contact_status_set_v1":
        current = {
          ...current,
          authStatus: mutation.authStatus,
          lastErrorCode: mutation.errorCode,
          lastErrorMessage: mutation.errorMessage,
          syncStartedAt: mutation.syncStartedAt,
          syncStatus: mutation.syncStatus,
          updatedAt: mutation.updatedAt,
        };
        break;
      case "device_contact_generation_begin_v1":
        buildingGenerationId = mutation.generationId;
        contacts = [];
        suggestions = [];
        current = {
          ...current,
          authStatus: "connected",
          syncStartedAt: mutation.startedAt,
          syncStatus: "syncing",
        };
        break;
      case "device_contact_delta_append_v1":
        contacts = [...contacts, ...mutation.contacts];
        break;
      case "device_contact_match_append_v1":
        suggestions = mutation.matches.flatMap((match) =>
          match.suggestion ? [match.suggestion] : [],
        );
        break;
      case "device_contact_generation_activate_v1":
        current = {
          ...current,
          activeContactCount: contacts.length,
          activeGenerationId: mutation.generationId,
          lastSyncedAt: mutation.activatedAt,
          pendingSuggestionCount: suggestions.length,
          syncStartedAt: null,
          syncStatus: "idle",
          syncToken: mutation.nextSyncToken,
          updatedAt: mutation.activatedAt,
        };
        buildingGenerationId = null;
        break;
      case "device_contact_suggestion_dismiss_v1":
        suggestions = suggestions.filter((suggestion) => suggestion.id !== mutation.suggestionId);
        current = { ...current, pendingSuggestionCount: suggestions.length };
        break;
    }
    return receipt(true);
  }) as LibraryCoreDeviceContactMutationExecutor & ReturnType<typeof vi.fn>;
  const query = vi.fn(async (request) => {
    switch (request.queryId) {
      case "device_contact_status_v1":
        return current;
      case "device_contact_match_page_v1":
        return {
          generationId: request.generationId,
          nextCursor: null,
          queryId: request.queryId,
          revision: current.revision,
          rows: request.generationId === buildingGenerationId ? contacts : [],
          schemaVersion: 1,
        };
      case "device_contact_suggestion_page_v1":
        return {
          nextCursor: null,
          queryId: request.queryId,
          revision: current.revision,
          rows: suggestions.map((suggestion) => ({
            contact: contacts.find((contact) => suggestion.id.includes(contact.resourceName))!,
            suggestion,
          })),
          schemaVersion: 1,
        };
      case "device_contact_unmatched_page_v1":
        return {
          nextCursor: null,
          queryId: request.queryId,
          revision: current.revision,
          rows: contacts.filter((contact) =>
            !suggestions.some((suggestion) => suggestion.id.includes(contact.resourceName))),
          schemaVersion: 1,
        };
    }
  }) as LibraryCoreDeviceContactQueryExecutor & ReturnType<typeof vi.fn>;
  return { mutate, query, readStatus: () => current };
}

function platform(runtime: ReturnType<typeof createContactRuntime>, overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  const store = <T,>(selector: (state: unknown) => T): T => selector({
    accounts: { "renderer-account": { id: "renderer-account" } },
    items: [{ globalId: "renderer-item" }],
    persons: { "renderer-person": { id: "renderer-person" } },
    setPendingMatchCount: vi.fn(),
  });
  return {
    store,
    mutateDeviceContacts: runtime.mutate,
    queryDeviceContacts: runtime.query,
    googleContacts: {
      connect: vi.fn(async () => {}),
      getToken: vi.fn(async () => "google-access-token"),
      fetchContacts: vi.fn(async () => ({ contacts: [], deleted: [], nextSyncToken: "next-token" })),
    },
    ...overrides,
  } as unknown as PlatformConfig;
}

describe("useContactSync", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    localStorage.clear();
    resetFactoryResetStateForTests();
    useBackgroundActivityStore.getState().clearBackgroundActivity();
    vi.restoreAllMocks();
  });

  async function mount(value: PlatformConfig): Promise<() => ContactSyncActions> {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let actions: ContactSyncActions | null = null;
    await act(async () => {
      root?.render(
        <PlatformProvider value={value}>
          <ContactSyncHarness onReady={(next) => { actions = next; }} />
        </PlatformProvider>,
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(actions).not.toBeNull());
    return () => actions!;
  }

  it("coalesces one provider fetch into one normalized generation", async () => {
    const runtime = createContactRuntime();
    let resolveFetch!: (value: { contacts: GoogleContact[]; deleted: string[]; nextSyncToken: string }) => void;
    const fetchContacts = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const getActions = await mount(platform(runtime, {
      googleContacts: {
        connect: vi.fn(async () => {}),
        getToken: vi.fn(async () => "google-access-token"),
        fetchContacts,
      },
    }));
    let first!: Promise<LibraryCoreDeviceContactStatusResponseV1>;
    let second!: Promise<LibraryCoreDeviceContactStatusResponseV1>;
    await act(async () => {
      first = getActions().syncNow({ force: true });
      second = getActions().syncNow({ force: true });
      await Promise.resolve();
    });
    expect(first).toBe(second);
    await vi.waitFor(() => expect(fetchContacts).toHaveBeenCalledOnce());
    await act(async () => {
      resolveFetch({ contacts: [], deleted: [], nextSyncToken: "next-token" });
      await first;
    });
    expect(runtime.readStatus()).toMatchObject({ syncStatus: "idle", syncToken: "next-token" });
    expect(runtime.mutate.mock.calls.map(([request]) => request.mutationKind)).toEqual([
      "device_contact_status_set_v1",
      "device_contact_generation_begin_v1",
      "device_contact_generation_activate_v1",
    ]);
  });

  it("matches only the bounded SQLite contact page", async () => {
    const runtime = createContactRuntime();
    const contact: GoogleContact = {
      emails: [{ value: "ada@example.com" }],
      name: { displayName: "Ada Lovelace", givenName: "Ada" },
      organizations: [],
      phones: [],
      photos: [],
      resourceName: "people/ada",
    };
    const queryLibraryCore = vi.fn(async () => ({
      accountIds: ["account:sqlite"],
      confidence: "high" as const,
      personId: "person:sqlite",
      queryId: "contact_match_v1" as const,
      schemaVersion: 1 as const,
      source: { generationId: "a".repeat(64), projectionRevision: 1, transitionSequence: 1 },
    }));
    const getActions = await mount(platform(runtime, {
      queryLibraryCore,
      googleContacts: {
        connect: vi.fn(async () => {}),
        getToken: vi.fn(async () => "google-access-token"),
        fetchContacts: vi.fn(async () => ({ contacts: [contact], deleted: [], nextSyncToken: "next-token" })),
      },
    }));
    await act(async () => { await getActions().syncNow({ force: true }); });
    expect(queryLibraryCore).toHaveBeenCalledOnce();
    expect(getActions().suggestionPage.rows).toEqual([
      expect.objectContaining({
        contact: expect.objectContaining({ resourceName: "people/ada" }),
        suggestion: expect.objectContaining({ accountIds: ["account:sqlite"], personId: "person:sqlite" }),
      }),
    ]);
    expect(runtime.query.mock.calls
      .filter(([request]) => request.queryId === "device_contact_match_page_v1")
      .every(([request]) => request.limit <= 64)).toBe(true);
  });

  it("fails closed in SQLite status when identity matching is unavailable", async () => {
    const runtime = createContactRuntime();
    const getActions = await mount(platform(runtime, {
      queryLibraryCore: undefined,
      googleContacts: {
        connect: vi.fn(async () => {}),
        getToken: vi.fn(async () => "google-access-token"),
        fetchContacts: vi.fn(async () => ({
          contacts: [{
            emails: [],
            name: { displayName: "Unmatched" },
            organizations: [],
            phones: [],
            photos: [],
            resourceName: "people/unmatched",
          }],
          deleted: [],
          nextSyncToken: "unaccepted-token",
        })),
      },
    }));
    await act(async () => { await getActions().syncNow({ force: true }); });
    expect(runtime.readStatus()).toMatchObject({
      lastErrorMessage: "The SQLite Library query boundary is unavailable.",
      syncStatus: "error",
      syncToken: null,
    });
  });

  it("imports the legacy ledger once and removes its localStorage authority", async () => {
    const legacy = {
      version: 1,
      authStatus: "connected" as const,
      cachedContacts: [{
        emails: [],
        name: { displayName: "Legacy Contact" },
        organizations: [],
        phones: [],
        photos: [],
        resourceName: "people/legacy",
      }],
      syncToken: "legacy-token",
    };
    localStorage.setItem(LEGACY_CONTACT_SYNC_STORAGE_KEY, JSON.stringify(legacy));
    const runtime = createContactRuntime();
    await mount(platform(runtime));
    await vi.waitFor(() => expect(localStorage.getItem(LEGACY_CONTACT_SYNC_STORAGE_KEY)).toBeNull());
    expect(runtime.readStatus()).toMatchObject({ activeContactCount: 1, syncToken: "legacy-token" });
    expect(runtime.mutate.mock.calls.filter(
      ([request]) => request.mutationKind === "device_contact_generation_begin_v1",
    )).toHaveLength(1);
  });
});

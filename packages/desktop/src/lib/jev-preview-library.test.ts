import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, ContentSignals, FeedItem, Person } from "@freed/shared";
import { applyJevPreviewSignals, loadJevPreviewRelationships, loadJevPreviewSample, refreshJevPreviewLibrary } from "./jev-preview-library";

const { commit, reload } = vi.hoisted(() => ({ commit: vi.fn(), reload: vi.fn() }));
vi.mock("./sqlite-library", () => ({ commitDesktopLibraryFeedItemAnalysisSets: commit }));
vi.mock("./library-client", () => ({ reloadSqliteLibraryState: reload }));

const fingerprint = {
  marker: "freed.sample-data.v1" as const,
  batchId: "synthetic-preview",
  generatedAt: 1,
  generatorVersion: 1,
};
const signals: ContentSignals = {
  version: 3, method: "ai", inferredAt: 2, scores: { event: 0.9 }, tags: ["event"],
};

function sample(id: string, platform: FeedItem["platform"] = "x",
  contentType: FeedItem["contentType"] = "post"): FeedItem {
  return {
    globalId: id, platform, contentType, capturedAt: 1, publishedAt: 1,
    author: { id: "synthetic-author", displayName: "Sample", handle: "sample" },
    content: { text: "Join our workshop tomorrow.", mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [], sampleDataFingerprint: { ...fingerprint },
  };
}

let items: Record<string, FeedItem>;
let accounts: Record<string, Account>;
let persons: Record<string, Person>;

beforeEach(() => {
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_TEST_TAURI", "1");
  vi.stubEnv("VITE_FREED_FEATURE_PREVIEW", "1");
  items = {};
  accounts = {};
  persons = {};
  vi.stubGlobal("window", {
    __TAURI_MOCK_BOOTSTRAPPED__: true,
    __TAURI_MOCK_SQLITE_LIBRARY__: { items, accounts, persons },
  });
  commit.mockReset().mockResolvedValue(undefined);
  reload.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Jev preview sample boundary", () => {
  it.each(["DEV", "VITE_TEST_TAURI", "VITE_FREED_FEATURE_PREVIEW"])(
    "rejects reads and writes when %s is disabled", async (flag) => {
      if (flag === "DEV") vi.stubEnv("DEV", false);
      else vi.stubEnv(flag, "0");
      await expect(loadJevPreviewSample()).rejects.toThrow("mocked feature preview");
      await expect(applyJevPreviewSignals(sample("a"), signals)).rejects.toThrow("mocked feature preview");
      await expect(loadJevPreviewRelationships([sample("a")])).rejects.toThrow("mocked feature preview");
      await expect(refreshJevPreviewLibrary()).rejects.toThrow("mocked feature preview");
      expect(commit).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    },
  );

  it("balances platform and format while never reading unmarked source content", async () => {
    const privateItem = { ...sample("private"), sampleDataFingerprint: undefined };
    Object.defineProperty(privateItem, "content", { get() { throw new Error("Private content read"); } });
    items.private = privateItem;
    const strata = [
      ["x", "post"], ["facebook", "post"], ["facebook", "story"],
      ["instagram", "post"], ["instagram", "story"], ["linkedin", "post"],
    ] as const;
    for (const [platform, type] of strata) {
      for (let index = 0; index < 100; index += 1) {
        const id = `${platform}:${type}:${index}`;
        items[id] = sample(id, platform, type);
      }
    }
    items.article = sample("article", "rss", "article");
    const result = await loadJevPreviewSample(12);
    expect(result).toHaveLength(12);
    for (const [platform, type] of strata) {
      expect(result.filter((item) => item.platform === platform && item.contentType === type)).toHaveLength(2);
    }
    result[0].content.text = "Edited snapshot";
    expect(items[result[0].globalId].content.text).toBe("Join our workshop tomorrow.");
    expect(await loadJevPreviewSample()).toHaveLength(500);
    await expect(loadJevPreviewSample(501)).rejects.toThrow("between 1 and 500");
  });

  it("returns the available sample count and rejects malformed provenance", async () => {
    items.valid = sample("valid");
    items.invalid = { ...sample("invalid"), sampleDataFingerprint: { ...fingerprint, batchId: "" } };
    expect((await loadJevPreviewSample()).map((item) => item.globalId)).toEqual(["valid"]);
    await expect(applyJevPreviewSignals(items.invalid, signals)).rejects.toThrow("sample items only");
  });
});

describe("Jev preview relationship context", () => {
  function linkSample(item: FeedItem, kind: Person["relationshipStatus"]): void {
    items[item.globalId] = item;
    const accountId = `social:${item.platform}:${item.author.id}`;
    const personId = `person:${item.globalId}`;
    accounts[accountId] = {
      id: accountId, kind: "social", provider: item.platform, externalId: item.author.id,
      personId, firstSeenAt: 1, lastSeenAt: 1, discoveredFrom: "captured_item",
      createdAt: 1, updatedAt: 1, sampleDataFingerprint: { ...fingerprint },
    };
    persons[personId] = {
      id: personId, name: `Sample ${kind}`, relationshipStatus: kind,
      careLevel: kind === "friend" ? 4 : 1, createdAt: 1, updatedAt: 1,
      sampleDataFingerprint: { ...fingerprint },
    };
  }

  it("returns known sample friends and connections while leaving unlinked authors unknown", async () => {
    const friend = sample("friend", "facebook");
    const connection = sample("connection", "instagram");
    const unknown = sample("unknown", "linkedin");
    linkSample(friend, "friend");
    linkSample(connection, "connection");
    items.unknown = unknown;
    expect(await loadJevPreviewRelationships([friend, connection, unknown])).toEqual({
      friend: { kind: "friend", name: "Sample friend" },
      connection: { kind: "connection", name: "Sample connection" },
      unknown: { kind: "unknown" },
    });
  });

  it("never reads private account links or person names", async () => {
    const friend = sample("friend");
    linkSample(friend, "friend");
    const account = accounts[`social:x:${friend.author.id}`];
    const person = persons[account.personId!];
    delete person.sampleDataFingerprint;
    Object.defineProperty(person, "name", { get() { throw new Error("Private name read"); } });
    expect(await loadJevPreviewRelationships([friend])).toEqual({ friend: { kind: "unknown" } });
    delete account.sampleDataFingerprint;
    Object.defineProperty(account, "personId", { get() { throw new Error("Private account link read"); } });
    expect(await loadJevPreviewRelationships([friend])).toEqual({ friend: { kind: "unknown" } });
  });

  it("rejects stale source identity and mismatched or foreign sample identities", async () => {
    const friend = sample("friend");
    linkSample(friend, "friend");
    const original = structuredClone(friend);
    friend.sampleDataFingerprint = { ...fingerprint, batchId: "replacement" };
    expect(await loadJevPreviewRelationships([original])).toEqual({ friend: { kind: "unknown" } });
    friend.sampleDataFingerprint = { ...fingerprint };
    friend.author = { ...friend.author, id: "changed-author" };
    expect(await loadJevPreviewRelationships([original])).toEqual({ friend: { kind: "unknown" } });
    friend.author = { ...original.author };
    const account = accounts[`social:x:${friend.author.id}`];
    account.provider = "facebook";
    expect(await loadJevPreviewRelationships([original])).toEqual({ friend: { kind: "unknown" } });
    account.provider = "x";
    persons[account.personId!].sampleDataFingerprint = { ...fingerprint, batchId: "another-sample" };
    expect(await loadJevPreviewRelationships([original])).toEqual({ friend: { kind: "unknown" } });
  });

  it("bounds enrichment and leaves unavailable identity maps unknown", async () => {
    const friend = sample("friend");
    items.friend = friend;
    expect(await loadJevPreviewRelationships([friend])).toEqual({ friend: { kind: "unknown" } });
    await expect(loadJevPreviewRelationships(Array.from({ length: 501 }, () => friend))).rejects.toThrow("at most 500");
  });
});

describe("Jev preview result admission", () => {
  it("rejects a removed item or changed text and recovers the mutation queue", async () => {
    const original = sample("a");
    await expect(applyJevPreviewSignals(original, signals)).rejects.toThrow("removed or replaced");
    items.a = { ...original, content: { ...original.content, text: "A different post." } };
    await expect(applyJevPreviewSignals(original, signals)).rejects.toThrow("evidence changed");
    expect(commit).not.toHaveBeenCalled();
    items.a = structuredClone(original);
    await applyJevPreviewSignals(original, signals);
    expect(commit).toHaveBeenCalledOnce();
  });

  it("rejects changed media evidence and replacement sample provenance", async () => {
    const original = sample("a");
    items.a = { ...original, content: { ...original.content, mediaTypes: ["image"] } };
    await expect(applyJevPreviewSignals(original, signals)).rejects.toThrow("evidence changed");
    items.a = { ...original, sampleDataFingerprint: { ...fingerprint, batchId: "replacement" } };
    await expect(applyJevPreviewSignals(original, signals)).rejects.toThrow("evidence changed");
    expect(commit).not.toHaveBeenCalled();
  });

  it("preserves the complete current event and excludes source and user fields from the write", async () => {
    const original = sample("a");
    items.a = {
      ...original,
      userState: { ...original.userState, saved: true, tags: ["keep"] },
      contentSignals: { ...signals, method: "manual", tags: ["request"] },
      eventCandidate: {
        version: 3, method: "manual", detectedAt: 3, confidence: 0.97,
        title: "Corrected title", startsAt: 4, endsAt: 5, timezone: "Etc/UTC",
        locationName: "Sample venue", locationUrl: "https://example.invalid/venue",
        evidence: "Complete event evidence",
      },
    };
    const before = structuredClone(items.a);
    await applyJevPreviewSignals(original, signals);
    expect(commit).toHaveBeenCalledWith([{
      entityId: "a", contentSignals: signals, eventCandidate: before.eventCandidate,
    }], expect.any(Number));
    expect(items.a).toEqual(before);
    expect(reload).not.toHaveBeenCalled();
    await refreshJevPreviewLibrary();
    expect(reload).toHaveBeenCalledOnce();
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]);
  });

  it("serializes concurrent commits and rereads the event after the preceding commit", async () => {
    const original = sample("a");
    items.a = structuredClone(original);
    const updatedEvent: FeedItem["eventCandidate"] = {
      version: 3, method: "manual", detectedAt: 3, confidence: 0.8, title: "Latest event",
    };
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    commit.mockImplementationOnce(async () => {
      entered();
      await new Promise<void>((resolve) => { release = resolve; });
      items.a.eventCandidate = updatedEvent;
      items.a.contentSignals = signals;
    });
    const first = applyJevPreviewSignals(original, signals);
    const second = applyJevPreviewSignals(original, signals);
    const refresh = refreshJevPreviewLibrary();
    await started;
    expect(commit).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second, refresh]);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit.mock.calls[1][0][0].eventCandidate).toEqual(updatedEvent);
    expect(reload).toHaveBeenCalledOnce();
    expect(commit.mock.invocationCallOrder[1]).toBeLessThan(reload.mock.invocationCallOrder[0]);
  });

  it("refreshes successful partial work after a later commit fails", async () => {
    const original = sample("a");
    items.a = structuredClone(original);
    commit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Commit failed"));
    await applyJevPreviewSignals(original, signals);
    await expect(applyJevPreviewSignals(original, signals)).rejects.toThrow("Commit failed");
    expect(reload).not.toHaveBeenCalled();
    await refreshJevPreviewLibrary();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reports a final refresh failure to the caller", async () => {
    reload.mockRejectedValueOnce(new Error("Refresh failed"));
    await expect(refreshJevPreviewLibrary()).rejects.toThrow("Refresh failed");
    expect(reload).toHaveBeenCalledOnce();
  });
});

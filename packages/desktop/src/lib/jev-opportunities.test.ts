import { afterEach, describe, expect, it, vi } from "vitest";
const { assertCurrent } = vi.hoisted(() => ({ assertCurrent: vi.fn() }));
vi.mock("./jev-library", () => ({ assertJevSourceCurrent: assertCurrent }));
import {
  createJevOpportunityDemo,
  parseJevCapabilities,
  runJevOpportunities,
  selectJevOpportunities,
} from "./jev-opportunities";

// Tier 1: personal relevance must not outlive its profile/source or invent an
// invitation. Inputs: opportunity projection, context contract, shared runner.
const now = 1_800_000_000_000;
afterEach(() => { vi.unstubAllGlobals(); assertCurrent.mockReset(); });

describe("opportunity admission", () => {
  it("requires explicit intent plus a lens-specific relevant capability", () => {
    const demo = createJevOpportunityDemo(now);
    expect(selectJevOpportunities({ ...demo, lens: "help", now })).toHaveLength(4);
    expect(selectJevOpportunities({ ...demo, lens: "collaborate", now })).toHaveLength(2);
    const prototype = demo.results[0].response!;
    prototype.collaborationInvitation = .99;
    expect(selectJevOpportunities({ ...demo, lens: "collaborate", now })
      .some((match) => match.item.globalId === demo.items[0].globalId)).toBe(false);
    prototype.helpCapabilityScores = [.1, .1, .1];
    expect(selectJevOpportunities({ ...demo, lens: "help", now })).toHaveLength(3);
  });

  it("rejects edited skills, sources, provenance, replaced authors, and model packs", () => {
    const original = createJevOpportunityDemo(now);
    expect(selectJevOpportunities({ ...original, capabilities: [...original.capabilities].reverse(), lens: "help", now })).toEqual([]);
    const altered = structuredClone(original);
    altered.items[0].content.text = "The request has been resolved.";
    altered.items[1].sampleDataFingerprint!.generatedAt += 1;
    altered.items[2].author.id = "different-author";
    altered.results[3].response!.questionPackVersion = "future-pack";
    expect(selectJevOpportunities({ ...altered, lens: "help", now })).toEqual([]);
    const expiredModel = createJevOpportunityDemo(now);
    expiredModel.results.forEach((result) => { result.response!.model = "different-model"; });
    expect(selectJevOpportunities({ ...expiredModel, lens: "help", now })).toEqual([]);
  });

  it("honors hidden, archived, dismissed and removed items and only completed results", () => {
    const demo = createJevOpportunityDemo(now);
    demo.items[0].userState.hidden = true;
    demo.items[1].userState.archived = true;
    demo.results[2].status = "cancelled";
    expect(selectJevOpportunities({ ...demo, lens: "help", now, dismissed: new Set([demo.items[3].globalId]) })).toEqual([]);
    expect(selectJevOpportunities({ ...createJevOpportunityDemo(now), items: [], lens: "help", now })).toEqual([]);
  });

  it("keeps unknown relationships honest and filters by confirmed Friend status", () => {
    const demo = createJevOpportunityDemo(now);
    const all = selectJevOpportunities({ ...demo, lens: "help", now });
    expect(all.some((match) => match.relationship.kind === "unknown")).toBe(true);
    expect(selectJevOpportunities({ ...demo, lens: "help", now, friendsOnly: true })).toHaveLength(2);
    expect(selectJevOpportunities({ ...demo, relationships: {}, lens: "help", now })
      .every((match) => match.relationship.kind === "unknown")).toBe(true);
    expect(selectJevOpportunities({ ...demo, relationships: {}, lens: "help", now, friendsOnly: true })).toEqual([]);
  });

  it("uses publication age, excludes unknown/future dates by default, and offers all dates", () => {
    const demo = createJevOpportunityDemo(now - 31 * 86_400_000);
    expect(selectJevOpportunities({ ...demo, lens: "help", now })).toEqual([]);
    expect(selectJevOpportunities({ ...demo, lens: "help", now, maxAgeDays: null })).toHaveLength(4);
    const fresh = createJevOpportunityDemo(now);
    fresh.items[0].publishedAt = now + 1;
    fresh.items[1].publishedAt = Number.NaN;
    expect(selectJevOpportunities({ ...fresh, lens: "help", now })).toHaveLength(2);
  });

  it("fails closed on malformed probabilities and bounded inputs", () => {
    const demo = createJevOpportunityDemo(now);
    demo.results[0].response!.helpCapabilityScores = [.99];
    demo.results[1].response!.explicitHelpRequest = 2;
    demo.results[2].response!.helpCapabilityScores[0] = Number.NaN;
    demo.results[3].response!.helpCapabilityScores[0] = -1;
    expect(selectJevOpportunities({ ...demo, lens: "help", now })).toEqual([]);
    expect(selectJevOpportunities({ ...createJevOpportunityDemo(now), lens: "help", now, minProbability: Number.NaN })).toEqual([]);
    expect(selectJevOpportunities({ ...demo, items: Array(501).fill(demo.items[0]), lens: "help", now })).toEqual([]);
  });

  it("validates declarations without deriving expertise from interests or duplicate rows", () => {
    expect(parseJevCapabilities("  Bike repair \n\nTypeScript review \r\n")).toEqual(["Bike repair", "TypeScript review"]);
    expect(() => parseJevCapabilities(" ")).toThrow("at least one");
    expect(() => parseJevCapabilities("Bike repair\nbike repair")).toThrow("once");
    expect(() => parseJevCapabilities("x".repeat(121))).toThrow("120");
    expect(() => parseJevCapabilities(Array.from({ length: 9 }, (_, i) => `Skill ${i}`).join("\n"))).toThrow("eight");
  });
});

describe("context run", () => {
  it("uses the separate endpoint, stamps exact profiles, skips unavailable evidence and never edits source analysis", async () => {
    const demo = createJevOpportunityDemo(now);
    const unavailable = structuredClone(demo.items[0]);
    unavailable.globalId = "empty";
    unavailable.content.text = "";
    const hidden = structuredClone(demo.items[0]);
    hidden.globalId = "hidden";
    hidden.userState.hidden = true;
    const privateItem = { ...demo.items[0], globalId: "private", sampleDataFingerprint: undefined };
    const privateContent = vi.fn(() => { throw new Error("Private source was read"); });
    Object.defineProperty(privateItem, "content", { get: privateContent });
    const original = structuredClone(demo.items[0]);
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(demo.results[0].response), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const results = await runJevOpportunities([demo.items[0], unavailable, hidden, privateItem], demo.capabilities, {
      signal: new AbortController().signal, onUpdate: () => {},
    });
    expect(results.map((result) => result.status)).toEqual(["success", "skipped", "skipped", "skipped"]);
    expect(privateContent).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/jev-preview/match");
    expect(demo.items[0]).toEqual(original);
    expect(selectJevOpportunities({ ...demo, results, lens: "help", now })).toHaveLength(1);
    expect(selectJevOpportunities({ ...demo, results, capabilities: ["Different skill"], lens: "help", now })).toEqual([]);
  });

  it("rejects a match whose native source changed during inference while retaining returned usage", async () => {
    const demo = createJevOpportunityDemo(now);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(demo.results[0].response), { status: 200 })));
    assertCurrent.mockRejectedValueOnce(new Error("The Library changed"));
    const results = await runJevOpportunities([demo.items[0]], demo.capabilities, {
      signal: new AbortController().signal, onUpdate: () => {},
    });
    expect(assertCurrent).toHaveBeenCalledWith(demo.items[0]);
    expect(results[0].status).toBe("failed");
    expect(results[0].response?.usage).toEqual(demo.results[0].response?.usage);
    expect(selectJevOpportunities({ ...demo, results, lens: "help", now })).toEqual([]);
  });

  it("does not start requests after cancellation or for oversized batches", async () => {
    const demo = createJevOpportunityDemo(now);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    const results = await runJevOpportunities(demo.items, demo.capabilities, {
      signal: controller.signal, onUpdate: () => {},
    });
    expect(results.every((result) => result.status === "cancelled")).toBe(true);
    await expect(runJevOpportunities(Array(501).fill(demo.items[0]), demo.capabilities, {
      signal: new AbortController().signal, onUpdate: () => {},
    })).rejects.toThrow("at most 500");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

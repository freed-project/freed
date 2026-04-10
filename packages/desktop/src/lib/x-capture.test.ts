/**
 * Integration tests for the X timeline capture pipeline.
 *
 * All tests use the injectable XRequester parameter so no Tauri IPC or real
 * network calls are made. The fixture JSON files in __fixtures__/ represent
 * real API response shapes (or the shapes we expect to handle gracefully).
 *
 * NOTE: x-timeline-response.json is currently a synthetic fixture. Replace
 * its contents with a real response pasted from the XSettingsSection
 * diagnostic panel after the first successful sync.
 */

import { describe, it, expect, vi } from "vitest";
import type { XCookies } from "./x-auth";

vi.mock("./store", () => ({
  useAppStore: {
    getState: () => ({
      items: [],
      fbAuth: {},
      setLoading: () => {},
      setError: () => {},
      setFbAuth: () => {},
      addItems: async () => {},
    }),
  },
}));

const { fetchXTimeline } = await import("./x-capture");

import timelineFixture from "./__fixtures__/x-timeline-response.json";
import emptyInstructionsFixture from "./__fixtures__/x-empty-instructions.json";
import missingHomeFixture from "./__fixtures__/x-missing-home.json";
import authErrorFixture from "./__fixtures__/x-auth-error.json";
import rateLimitFixture from "./__fixtures__/x-rate-limit.json";

// =============================================================================
// Helpers
// =============================================================================

const fakeCookies: XCookies = { ct0: "fake_ct0", authToken: "fake_auth_token" };

/** Requester that always resolves with a serialised fixture object */
function requesterFor(fixture: object) {
  return vi.fn().mockResolvedValue(JSON.stringify(fixture));
}

/** Requester that always rejects (simulates Tauri IPC failure) */
function failingRequester(message = "Network error") {
  return vi.fn().mockRejectedValue(new Error(message));
}

/** Requester that returns malformed (non-JSON) text */
function brokenJsonRequester() {
  return vi.fn().mockResolvedValue("<!DOCTYPE html><html>Rate limit page</html>");
}

// =============================================================================
// Tests
// =============================================================================

describe("fetchXTimeline", () => {
  describe("happy path", () => {
    it("extracts tweets from a well-formed timeline response", async () => {
      const result = await fetchXTimeline(fakeCookies, requesterFor(timelineFixture));

      expect(result.diag.instructionsFound).toBeGreaterThan(0);
      expect(result.diag.tweetsExtracted).toBeGreaterThan(0);
      expect(result.diag.itemsNormalized).toBeGreaterThan(0);
      expect(result.diag.errorStage).toBeNull();
      expect(result.items.length).toBeGreaterThan(0);
    });

    it("sets rawResponseBytes to the byte length of the response", async () => {
      const raw = JSON.stringify(timelineFixture);
      const result = await fetchXTimeline(fakeCookies, vi.fn().mockResolvedValue(raw));

      expect(result.diag.rawResponseBytes).toBe(raw.length);
    });

    it("sets rawResponsePreview to the first 500 chars", async () => {
      const raw = JSON.stringify(timelineFixture);
      const result = await fetchXTimeline(fakeCookies, vi.fn().mockResolvedValue(raw));

      expect(result.diag.rawResponsePreview).toBe(raw.slice(0, 500));
    });

    it("produces FeedItems with platform='x' and correctly-shaped globalIds", async () => {
      const result = await fetchXTimeline(fakeCookies, requesterFor(timelineFixture));

      for (const item of result.items) {
        expect(item.platform).toBe("x");
        expect(item.globalId).toMatch(/^x:\d+$/);
      }
    });

    it("deduplicates items — itemsDeduplicated <= itemsNormalized", async () => {
      const result = await fetchXTimeline(fakeCookies, requesterFor(timelineFixture));

      expect(result.diag.itemsDeduplicated).toBeLessThanOrEqual(
        result.diag.itemsNormalized,
      );
    });

    it("itemsAdded starts at 0 (store integration is captureXTimeline's job)", async () => {
      const result = await fetchXTimeline(fakeCookies, requesterFor(timelineFixture));

      // fetchXTimeline doesn't touch the store — that's captureXTimeline's job
      expect(result.diag.itemsAdded).toBe(0);
    });

    it("skips promoted timeline entries", async () => {
      const promotedOnly = {
        data: {
          home: {
            home_timeline_urt: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [
                    {
                      entryId: "promoted-tweet-1",
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: (timelineFixture as { data: { home: { home_timeline_urt: { instructions: Array<{ entries: Array<{ content: { itemContent: { tweet_results: { result: unknown } } } }> }> } } } }).data.home.home_timeline_urt.instructions[0].entries[0].content.itemContent.tweet_results.result,
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      };

      const result = await fetchXTimeline(fakeCookies, requesterFor(promotedOnly));

      expect(result.diag.instructionsFound).toBe(1);
      expect(result.diag.tweetsExtracted).toBe(0);
      expect(result.items).toHaveLength(0);
    });
  });

  describe("transport errors", () => {
    it("returns errorStage='transport' when the requester throws", async () => {
      const result = await fetchXTimeline(fakeCookies, failingRequester("Connection refused"));

      expect(result.diag.errorStage).toBe("transport");
      expect(result.diag.errorMessage).toContain("Connection refused");
      expect(result.items).toHaveLength(0);
    });

    it("sets rawResponseBytes to 0 on transport error", async () => {
      const result = await fetchXTimeline(fakeCookies, failingRequester());

      expect(result.diag.rawResponseBytes).toBe(0);
    });
  });

  describe("parse errors", () => {
    it("returns errorStage='parse' when the response is not valid JSON", async () => {
      const result = await fetchXTimeline(fakeCookies, brokenJsonRequester());

      expect(result.diag.errorStage).toBe("parse");
      expect(result.diag.errorMessage).toContain("JSON.parse failed");
      expect(result.items).toHaveLength(0);
    });

    it("sets rawResponsePreview to the raw text even when parsing fails", async () => {
      const html = "<!DOCTYPE html><html>oops</html>";
      const result = await fetchXTimeline(
        fakeCookies,
        vi.fn().mockResolvedValue(html),
      );

      expect(result.diag.rawResponsePreview).toBe(html.slice(0, 500));
    });
  });

  describe("auth errors", () => {
    it("returns errorStage='auth' for code-32 error bodies", async () => {
      const result = await fetchXTimeline(fakeCookies, requesterFor(authErrorFixture));

      expect(result.diag.errorStage).toBe("auth");
      expect(result.diag.errorMessage).toBeTruthy();
      expect(result.items).toHaveLength(0);
    });

    it("returns errorStage='auth' for code-89 (expired token) bodies", async () => {
      const expiredToken = { errors: [{ code: 89, message: "Invalid or expired token." }] };
      const result = await fetchXTimeline(fakeCookies, requesterFor(expiredToken));

      expect(result.diag.errorStage).toBe("auth");
    });
  });

  describe("rate limiting", () => {
    it("returns errorStage='provider_rate_limit' for code-88 bodies", async () => {
      const result = await fetchXTimeline(fakeCookies, requesterFor(rateLimitFixture));

      expect(result.diag.errorStage).toBe("provider_rate_limit");
      expect(result.diag.errorMessage).toContain("15 minutes");
      expect(result.items).toHaveLength(0);
    });
  });

  describe("empty / malformed timeline data", () => {
    it("returns errorStage='instructions' when instructions array is empty", async () => {
      const result = await fetchXTimeline(fakeCookies, requesterFor(emptyInstructionsFixture));

      expect(result.diag.errorStage).toBe("instructions");
      expect(result.diag.instructionsFound).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it("returns errorStage='instructions' when the 'home' key is absent", async () => {
      const result = await fetchXTimeline(fakeCookies, requesterFor(missingHomeFixture));

      expect(result.diag.errorStage).toBe("instructions");
      expect(result.items).toHaveLength(0);
    });

    it("returns 0 items (no error) when a TimelineAddEntries instruction contains no tweets", async () => {
      const noTweets = {
        data: {
          home: {
            home_timeline_urt: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [
                    {
                      entryId: "cursor-top",
                      sortIndex: "9999",
                      content: {
                        entryType: "TimelineTimelineCursor",
                        __typename: "TimelineTimelineCursor",
                        value: "cursor_token",
                        cursorType: "Top",
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      };
      const result = await fetchXTimeline(fakeCookies, requesterFor(noTweets));

      // instructionsFound === 1 but tweetsExtracted === 0 — not an error, just empty
      expect(result.diag.instructionsFound).toBe(1);
      expect(result.diag.tweetsExtracted).toBe(0);
      expect(result.diag.errorStage).toBeNull();
      expect(result.items).toHaveLength(0);
    });
  });

  describe("requester is actually called with correct args", () => {
    it("calls the requester exactly once per fetchXTimeline call", async () => {
      const req = requesterFor(timelineFixture);
      await fetchXTimeline(fakeCookies, req);

      expect(req).toHaveBeenCalledTimes(1);
    });

    it("passes the ct0 cookie in the headers", async () => {
      const req = requesterFor(timelineFixture);
      const cookies: XCookies = { ct0: "my_ct0_value", authToken: "my_auth" };
      await fetchXTimeline(cookies, req);

      const [, , headerPairs] = req.mock.calls[0] as [string, string, Array<[string, string]>];
      const headers = Object.fromEntries(headerPairs);
      expect(headers["x-csrf-token"]).toBe("my_ct0_value");
      expect(headers.cookie).toContain("ct0=my_ct0_value");
    });

    it("passes auth_token in the cookie header", async () => {
      const req = requesterFor(timelineFixture);
      const cookies: XCookies = { ct0: "ct0_val", authToken: "auth_val" };
      await fetchXTimeline(cookies, req);

      const [, , headerPairs] = req.mock.calls[0] as [string, string, Array<[string, string]>];
      const headers = Object.fromEntries(headerPairs);
      expect(headers.cookie).toContain("auth_token=auth_val");
    });
  });
});

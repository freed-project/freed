import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPinnedHighlightsToRelease,
  buildReleaseDeck,
  compareTags,
  compareVersionDays,
  coerceReleaseShape,
  dayDateFromVersion,
  normalizePinnedHighlightTexts,
  removePreviousDayFeatureRepeats,
  renderReleaseBody,
  validateReleaseShape,
  versionDayKey,
} from "./release-notes-shared.mjs";

test("coerceReleaseShape supports legacy fields", () => {
  const release = coerceReleaseShape({
    summary: "Native macOS code signing for effortless installs",
    whatsNew: [
      "Native macOS code signing for effortless installs",
      "Add macOS code signing to release pipeline",
    ],
    fixes: ["Recycle social scraper webviews after each run"],
    performance: ["Faster startup checks"],
  });

  assert.equal(release.deck, "Native macOS code signing for effortless installs");
  assert.deepEqual(release.features, ["Signed macOS installs"]);
  assert.deepEqual(release.fixes, [
    "Social scraper webviews are now recycled after each run",
  ]);
  assert.deepEqual(release.followUps, [
    "Faster startup checks",
  ]);
});

test("validateReleaseShape rejects deck duplication", () => {
  const result = validateReleaseShape({
    deck: "Native macOS code signing for effortless installs",
    features: [
      "Native macOS code signing for effortless installs",
      "Legal consent gates across surfaces",
    ],
    followUps: [],
  });

  assert.match(result.errors.join("\n"), /Deck duplicates feature/);
});

test("validateReleaseShape allows a feature to reinforce the deck theme", () => {
  const result = validateReleaseShape({
    deck: "Native macOS code signing for effortless installs",
    features: [
      "Signed macOS releases now install cleanly through Gatekeeper",
      "Ship shared map and friends workspace",
    ],
    followUps: [],
  });

  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.normalizedRelease.features, [
    "Signed macOS releases now install cleanly through Gatekeeper",
    "New map and Friends views",
  ]);
});

test("validateReleaseShape rejects too many features", () => {
  const result = validateReleaseShape({
    deck: "Code signing and legal gating landed",
    features: [
      "Native macOS code signing for effortless installs",
      "Legal consent gates across surfaces",
      "Google Contacts sync lands in Friends",
      "Signed auto-updates reach every build",
    ],
    followUps: [],
  });

  assert.match(result.errors.join("\n"), /Features must contain at most 3 items/);
});

test("validateReleaseShape rejects non-additive latest-of-day releases", () => {
  const result = validateReleaseShape(
    {
      deck: "Code signing shipped",
      features: ["Code signing shipped"],
      followUps: ["Recycle social scraper webviews after each run"],
    },
    {
      earlierReleases: [
        {
          deck: "Legal consent gates across surfaces",
          features: ["Legal consent gates across surfaces"],
          followUps: [],
        },
      ],
    },
  );

  assert.match(result.errors.join("\n"), /missing earlier same-day item/i);
});

test("validateReleaseShape allows same-day consolidation for follow-ups", () => {
  const result = validateReleaseShape(
    {
      deck: "Privacy policy, feed healing, and RSS subscriptions",
      features: [
        "Privacy policy page",
        "Bulk unsubscribe and factory reset features",
        "RSS subscriptions from the PWA",
      ],
      fixes: [],
      followUps: ["Reader, sidebar, and settings UX work"],
    },
    {
      earlierReleases: [
        {
          deck: "Privacy policy and connection UX",
          features: ["Privacy policy page"],
          fixes: [],
          followUps: ["Polish SyncConnectDialog UX"],
        },
      ],
    },
  );

  assert.equal(result.errors.length, 0);
});

test("validateReleaseShape allows production carry-forward feature consolidation", () => {
  const result = validateReleaseShape(
    {
      deck: "Capture stability and map controls",
      features: [
        "Map now uses a lower-left time range slider",
        "Provider capture controls stay consent-gated",
      ],
      fixes: [],
      followUps: [
        "Capture, login, and scraping platform work",
        "Reader, sidebar, and settings UX work",
        "Testing, diagnostics, and developer tooling",
      ],
    },
    {
      earlierReleases: [
        {
          deck: "Consent-gated auth loading",
          features: ["Consent-gated auth loading"],
          fixes: [],
          followUps: [],
        },
        {
          deck: "Map time range slider",
          features: ["Map time range slider"],
          fixes: [],
          followUps: [],
        },
        {
          deck: "Structured window_destroyed kill records",
          features: ["Structured window_destroyed kill records"],
          fixes: [],
          followUps: [],
        },
      ],
    },
  );

  assert.equal(result.errors.length, 0);
});

test("validateReleaseShape can relax production carry-forward feature omissions", () => {
  const release = {
    deck: "Capture stability and map controls",
    features: ["Provider capture controls stay consent-gated"],
    fixes: [],
    followUps: ["Release workflow and build-system work"],
  };
  const options = {
    earlierReleases: [
      {
        deck: "Mobile pairing shipped",
        features: ["Google Drive sync recovery"],
        fixes: [],
        followUps: [],
      },
    ],
  };

  assert.match(
    validateReleaseShape(release, options).errors.join("\n"),
    /missing earlier same-day item/i,
  );
  assert.equal(
    validateReleaseShape(release, {
      ...options,
      allowEarlierFeatureOmission: true,
    }).errors.length,
    0,
  );
});

test("validateReleaseShape can relax production carry-forward support omissions", () => {
  const release = {
    deck: "Capture stability and map controls",
    features: ["Provider capture controls stay consent-gated"],
    fixes: ["Scraper login prompts now stay open until the provider window closes"],
    followUps: ["Release workflow and build-system work"],
  };
  const options = {
    earlierReleases: [
      {
        deck: "Tooling and soak support",
        features: [],
        fixes: ["Soak collector and soak assert scripts with a machine readable verdict"],
        followUps: ["Automation loop state moved out of tmp into Freed automation storage"],
      },
    ],
  };

  assert.match(
    validateReleaseShape(release, options).errors.join("\n"),
    /missing earlier same-day item/i,
  );
  assert.equal(
    validateReleaseShape(release, {
      ...options,
      allowEarlierItemOmission: true,
    }).errors.length,
    0,
  );
});

test("validateReleaseShape rejects previous-day feature repeats", () => {
  const result = validateReleaseShape(
    {
      deck: "Story wall publishing and smoother dense graph motion",
      features: ["Story wall publishing"],
      fixes: ["Dense Friends graph motion paints fewer nodes while panning"],
      followUps: [],
    },
    {
      previousDayRelease: {
        deck: "Story wall publishing",
        features: ["Story wall publishing"],
        fixes: ["Google Contacts sync in Freed Desktop"],
        followUps: [],
      },
    },
  );

  assert.match(result.errors.join("\n"), /repeats previous-day feature/i);
});

test("validateReleaseShape does not force stale previous-day features forward", () => {
  const result = validateReleaseShape(
    {
      deck: "Google OAuth and dense Map motion",
      features: ["Story wall publishing"],
      fixes: ["Complete Google Contacts sync in Freed Desktop"],
      followUps: [],
    },
    {
      previousDayRelease: {
        deck: "AI ranked friend suggestions",
        features: ["AI ranked friend suggestions"],
        fixes: [],
        followUps: [],
      },
      earlierReleases: [
        {
          deck: "AI ranked friend suggestions and Friends graph pinch zoom",
          features: ["AI ranked friend suggestions"],
          fixes: ["Complete Google Contacts sync in Freed Desktop"],
          followUps: [],
        },
      ],
    },
  );

  assert.equal(result.errors.length, 0);
});

test("removePreviousDayFeatureRepeats strips generated stale feature repeats", () => {
  const release = removePreviousDayFeatureRepeats(
    {
      deck: "Dev build 1808",
      features: [
        "Dev-channel prereleases now include a terminal helper for installed-build sync soaks",
      ],
      fixes: [
        "Renderer recovery now ignores reclaimable WebKit RSS tail while footprint is healthy",
        "Dev-channel prereleases now include a terminal helper for installed-build sync soaks",
      ],
      followUps: [
        "Terminal trigger docs stay available for unattended soaks",
      ],
    },
    {
      deck: "Dev-channel prereleases and terminal sync soaks",
      features: [
        "Dev-channel prereleases now include a terminal helper for installed-build sync soaks",
      ],
      fixes: [],
      followUps: [],
    },
  );

  assert.deepEqual(release.features, []);
  assert.deepEqual(release.fixes, [
    "Renderer recovery now ignores reclaimable WebKit RSS tail while footprint is healthy",
  ]);
  assert.deepEqual(release.followUps, [
    "Terminal trigger docs stay available for unattended soaks",
  ]);
});

test("normalizePinnedHighlightTexts supports string and object entries", () => {
  assert.deepEqual(
    normalizePinnedHighlightTexts([
      "The quiet startup contract now records the occlusion recovery policy in native tests and the desktop phase notes",
      { text: "Terminal trigger docs stay available for unattended soaks" },
      { text: "" },
      null,
    ]),
    [
      "The quiet startup contract now records the occlusion recovery policy in native tests and the desktop phase notes",
      "Terminal trigger docs stay available for unattended soaks",
    ],
  );
});

test("applyPinnedHighlightsToRelease keeps missing pinned items visible", () => {
  assert.deepEqual(
    applyPinnedHighlightsToRelease(
      {
        deck: "More reliable unattended desktop validation",
        fixes: ["Harden quiet startup and sync recovery"],
        followUps: [],
      },
      [
        "The quiet startup contract now records the occlusion recovery policy in native tests and the desktop phase notes",
      ],
    ).fixes,
    [
      "The quiet startup contract now records the occlusion recovery policy in native tests and the desktop phase notes",
    ],
  );
});

test("applyPinnedHighlightsToRelease treats a matching deck theme as visible", () => {
  const release = applyPinnedHighlightsToRelease(
    {
      deck: "Friends is now a theme-aware personal galaxy with native touch and trackpad navigation, tight identity constellations, and cosmic provider nebulae",
      features: [
        "Explore Friends as a hardware-accelerated 3D galaxy where relationship importance controls depth",
      ],
      fixes: ["Release validation now installs every required browser"],
      followUps: [],
    },
    ["Friends Galaxy"],
  );

  assert.deepEqual(release.fixes, [
    "Release validation now installs every required browser",
  ]);
  assert.deepEqual(validateReleaseShape(release).errors, []);
});

test("validateReleaseShape allows previous-day theme overlap in the deck", () => {
  const result = validateReleaseShape(
    {
      deck: "Dev-channel prereleases and renderer recovery",
      features: [],
      fixes: [
        "Renderer recovery now ignores reclaimable WebKit RSS tail while footprint is healthy",
      ],
      followUps: [],
    },
    {
      previousDayRelease: {
        deck: "Dev-channel prereleases",
        features: [
          "Dev-channel prereleases now include a terminal helper for installed-build sync soaks",
        ],
        fixes: [],
        followUps: [],
      },
    },
  );

  assert.equal(result.errors.length, 0);
});

test("renderReleaseBody uses the new headings", () => {
  const body = renderReleaseBody("v26.4.108", {
    deck: "Native macOS code signing for effortless installs",
    features: ["Legal consent gates across surfaces"],
    fixes: ["Recycle social scraper webviews after each run"],
    followUps: ["Finalize qr landing page experience"],
  });

  assert.match(body, /### Features/);
  assert.match(body, /### Fixes/);
  assert.match(body, /### Follow-ups/);
  assert.doesNotMatch(body, /### What's New/);
});

test("buildReleaseDeck composes a terse noun-phrase heading", () => {
  const deck = buildReleaseDeck({
    features: [
      "Ship shared map and friends workspace",
      "Add legal consent gates across surfaces",
      "Add macOS code signing to release pipeline",
    ],
    fixes: [
      "Recycle social scraper webviews after each run",
    ],
  });

  assert.equal(deck, "New map and Friends views, signed macOS installs, and refined consent gates");
});

test("buildReleaseDeck honors a preferred deck override", () => {
  const deck = buildReleaseDeck(
    {
      features: [
        "Ship shared map and friends workspace",
        "Add legal consent gates across surfaces",
      ],
    },
    {
      preferredDeck: "Map view, refined consent gates, and signed macOS installs",
    },
  );

  assert.equal(deck, "Map view, refined consent gates, and signed macOS installs");
});

test("compareTags sorts dev releases before production for the same base version", () => {
  assert.equal(compareTags("v26.4.1200-dev", "v26.4.1200"), -1);
  assert.equal(compareTags("v26.4.1200", "v26.4.1200-dev"), 1);
  assert.equal(compareTags("v26.4.1201-dev", "v26.4.1200"), 1);
});

test("compareVersionDays sorts CalVer days numerically", () => {
  assert.ok(compareVersionDays("v26.5.914-dev", "v26.5.1000-dev") < 0);
  assert.ok(compareVersionDays("v26.5.1016-dev", "v26.5.1100-dev") < 0);
  assert.ok(compareVersionDays("v26.5.1300-dev", "v26.5.2600-dev") < 0);
  assert.ok(compareVersionDays("v26.5.1000-dev", "v26.5.914-dev") > 0);
  assert.ok(compareVersionDays("v26.4.3006-dev", "v26.5.100-dev") < 0);
});

test("day helpers ignore the dev suffix", () => {
  assert.equal(versionDayKey("26.4.1207-dev"), "26.4.12");
  assert.equal(dayDateFromVersion("26.4.1207-dev"), "2026-04-12");
});

// Generator contracts run offline at the entry collection boundary, before writes.
// Importing the CLI must not start release preparation.
const { collectReleaseEntries } = await import("./prepare-release-notes.mjs");
const provenanceSha = "2721d818f6bd5e6fdd62203bb07e9fc761f4f2cf";
function mergedProvenancePull(overrides = {}) {
  return {
    number: 2163,
    html_url: "https://github.com/freed-project/freed/pull/2163",
    merge_commit_sha: provenanceSha,
    merged_at: "2026-10-07T01:00:00Z",
    base: { ref: "dev", repo: { full_name: "freed-project/freed" } },
    title: "feat: repair release admission",
    body: "## What changed\n\n- Release admission uses the exact source.",
    ...overrides,
  };
}
function collectProvenance(associations, options = {}) {
  return collectReleaseEntries(
    [{ sha: provenanceSha, subject: "feat: repair release admission (#9999)" }],
    { channel: "dev", headers: {}, requestJson: async () => associations, ...options },
  );
}

test("release provenance resolves a merged squash without a subject suffix", async () => {
  const calls = [];
  const result = await collectReleaseEntries(
    [{ sha: provenanceSha, subject: "feat: add Linux Library credentials and repair release admission" }],
    { channel: "dev", headers: {}, requestJson: async (url) => {
      calls.push(url);
      return [mergedProvenancePull()];
    } },
  );
  assert.deepEqual(calls, [`https://api.github.com/repos/freed-project/freed/commits/${provenanceSha}/pulls?per_page=100&page=1`]);
  assert.deepEqual(result.prNumbers, [2163]);
  assert.equal(result.entries[0].prNumber, 2163);
  assert.equal(result.entries[0].title, "Repair release admission");
  assert.deepEqual(result.entries[0].details, ["Release admission uses the exact source"]);
});

test("release provenance ignores suffix guesses and mismatched commit, repository or lane", async (t) => {
  for (const [name, overrides] of [
    ["commit", { merge_commit_sha: "a".repeat(40) }],
    ["repository", { base: { ref: "dev", repo: { full_name: "other/freed" } } }],
    ["lane", { base: { ref: "www", repo: { full_name: "freed-project/freed" } } }],
    ["production lane in dev", { base: { ref: "main", repo: { full_name: "freed-project/freed" } } }],
    ["unmerged", { merged_at: null }],
    ["missing", null],
  ]) {
    await t.test(name, async () => {
      const result = await collectProvenance(overrides === null ? [] : [mergedProvenancePull(overrides)]);
      assert.deepEqual(result.prNumbers, []);
      assert.equal(result.entries[0].prNumber, null);
      assert.deepEqual(result.entries[0].details, []);
    });
  }
  const verified = await collectProvenance([mergedProvenancePull()]);
  assert.deepEqual(verified.prNumbers, [2163]);
});

test("release provenance stops on unavailable, malformed or ambiguous authoritative lookup", async () => {
  const cause = new Error("transport unavailable");
  await assert.rejects(collectProvenance([], { requestJson: async () => { throw cause; } }),
    (error) => /lookup unavailable/.test(error.message) && error.cause === cause);
  await assert.rejects(collectProvenance({ message: "rate limited" }), /Invalid PR association response/);
  await assert.rejects(collectProvenance([mergedProvenancePull({ html_url: "https://github.com/other/freed/pull/2163" })]), /Invalid merged PR identity/);
  await assert.rejects(collectProvenance([
    mergedProvenancePull(),
    mergedProvenancePull({ number: 2164, html_url: "https://github.com/freed-project/freed/pull/2164" }),
  ]), /Ambiguous merged PR association/);
});

test("release provenance paginates, deduplicates immutable lookups and bounds total requests", async () => {
  let requests = 0;
  const unrelated = mergedProvenancePull({ merge_commit_sha: "a".repeat(40) });
  const result = await collectReleaseEntries([
    { sha: provenanceSha, subject: "feat: repair admission" },
    { sha: provenanceSha, subject: "feat: repair admission" },
    { sha: "b".repeat(40), subject: "docs: release instructions (#9999)" },
  ], { channel: "dev", headers: {}, requestJson: async (url) => {
    requests += 1;
    assert.ok(url.endsWith(`page=${requests}`));
    return requests === 1 ? Array(100).fill(unrelated) : [mergedProvenancePull()];
  } });
  assert.equal(requests, 2);
  assert.deepEqual(result.prNumbers, [2163]);
  requests = 0;
  await assert.rejects(collectProvenance([], { requestJson: async () => {
    requests += 1;
    return Array(100).fill(unrelated);
  } }), /lookup budget exceeded/);
  assert.equal(requests, 500);
});

test("production provenance accepts exact dev and main merges but excludes website merges", async () => {
  for (const lane of ["dev", "main", "www"]) {
    const result = await collectProvenance([mergedProvenancePull({
      base: { ref: lane, repo: { full_name: "freed-project/freed" } },
    })], { channel: "production" });
    assert.deepEqual(result.prNumbers, lane === "www" ? [] : [2163]);
  }
  await assert.rejects(collectReleaseEntries([{ sha: "short", subject: "feat: change" }], {
    channel: "dev", headers: {}, requestJson: async () => { assert.fail("invalid SHA must not reach transport"); },
  }), /full immutable commit SHAs/);
});

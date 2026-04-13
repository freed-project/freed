import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReleaseDeck,
  compareTags,
  coerceReleaseShape,
  dayDateFromVersion,
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

test("day helpers ignore the dev suffix", () => {
  assert.equal(versionDayKey("26.4.1207-dev"), "26.4.12");
  assert.equal(dayDateFromVersion("26.4.1207-dev"), "2026-04-12");
});

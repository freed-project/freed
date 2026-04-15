import assert from "node:assert/strict";
import test from "node:test";
import {
  groupReleasesByDay,
  normalizeGitHubReleases,
  versionDayKey,
  type ParsedRelease,
} from "./changelog";

const release = (
  tagName: string,
  prerelease: boolean,
  publishedAt: string,
): {
  tag_name: string;
  body: string;
  published_at: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
} => ({
  tag_name: tagName,
  body: "## Freed\n\nRelease deck.\n\n### Features\n- Visible release item\n",
  published_at: publishedAt,
  html_url: `https://example.com/${tagName}`,
  draft: false,
  prerelease,
});

test("normalizes production and dev releases with channel metadata", () => {
  const releases = normalizeGitHubReleases([
    release("v26.4.1500-dev", true, "2026-04-15T19:00:00Z"),
    release("v26.4.1400", false, "2026-04-14T19:00:00Z"),
  ]);

  assert.deepEqual(
    releases.map((item) => [item.version, item.channel]),
    [
      ["26.4.1500-dev", "dev"],
      ["26.4.1400", "production"],
    ],
  );
  assert.equal(releases[0].buildLinks[0].channel, "dev");
});

test("excludes drafts and mismatched prerelease metadata", () => {
  const draft = release("v26.4.1500", false, "2026-04-15T19:00:00Z");
  draft.draft = true;

  const releases = normalizeGitHubReleases([
    draft,
    release("v26.4.1501-dev", false, "2026-04-15T20:00:00Z"),
    release("v26.4.1502", true, "2026-04-15T21:00:00Z"),
    release("v26.4.1503", false, "2026-04-15T22:00:00Z"),
  ]);

  assert.deepEqual(
    releases.map((item) => item.tagName),
    ["v26.4.1503"],
  );
});

test("uses the base version when deriving dev release day keys", () => {
  assert.equal(versionDayKey("26.4.1500-dev"), "26.4.15");
});

test("groups same-day production and dev releases separately", () => {
  const releases = normalizeGitHubReleases([
    release("v26.4.1501-dev", true, "2026-04-15T21:00:00Z"),
    release("v26.4.1500", false, "2026-04-15T20:00:00Z"),
    release("v26.4.1502", false, "2026-04-15T22:00:00Z"),
  ]);
  const grouped = groupReleasesByDay(releases);

  assert.deepEqual(
    grouped.map((item: ParsedRelease) => [item.version, item.channel]),
    [
      ["26.4.1502", "production"],
      ["26.4.1501-dev", "dev"],
    ],
  );
  assert.deepEqual(grouped[0].builds, ["26.4.1500", "26.4.1502"]);
});

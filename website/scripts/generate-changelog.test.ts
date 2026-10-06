import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchPublishedArtifact,
  fetchComparePrNumbers,
  assertReleaseCoverage,
  generateChangelog,
} from "./generate-changelog";
import {
  normalizeGitHubReleases,
  groupReleasesByDay,
} from "../src/content/changelog";

test("loads approved PR provenance from the published tag without a local artifact", async (t) => {
  const artifact = {
    tag: "v26.10.500-dev",
    approved: true,
    release: { fixes: ["Fix loading"] },
    source: { prNumbers: [2135] },
  };
  t.mock.method(globalThis, "fetch", async (url: string) => {
    assert.equal(
      url,
      "https://raw.githubusercontent.com/freed-project/freed/v26.10.500-dev/release-notes/releases/v26.10.500-dev.json",
    );
    return Response.json(artifact);
  });
  assert.deepEqual(await fetchPublishedArtifact(artifact.tag), artifact);
});

test("only missing historical artifacts permit the release-body fallback", async (t) => {
  const request = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 404 }),
  );
  assert.equal(await fetchPublishedArtifact("v26.3.100"), null);
  request.mock.mockImplementation(
    async () => new Response(null, { status: 503 }),
  );
  await assert.rejects(fetchPublishedArtifact("v26.10.500-dev"), /503/);
});

test("rejects unapproved and mismatched tag artifacts", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ tag: "v26.10.500-dev", approved: false, release: {} }),
  );
  await assert.rejects(fetchPublishedArtifact("v26.10.500-dev"), /approval/);
  request.mock.mockImplementation(async () =>
    Response.json({ tag: "v26.10.403-dev", approved: true, release: {} }),
  );
  await assert.rejects(fetchPublishedArtifact("v26.10.500-dev"), /mismatched/);
});

test("checks every build in daily groups and rejects an unpublished expected release", () => {
  const releases = ["v26.10.400-dev", "v26.10.403-dev"].map((tag_name) => ({
    tag_name,
    body: "### Fixes\n- Fix loading",
    published_at: "2026-10-05T00:00:00Z",
    html_url: `https://github.com/freed-project/freed/releases/tag/${tag_name}`,
    draft: false,
    prerelease: true,
  }));
  const snapshot = groupReleasesByDay(normalizeGitHubReleases(releases));
  assertReleaseCoverage(releases, snapshot, "v26.10.403-dev");
  assert.throws(
    () => assertReleaseCoverage(releases, snapshot, "v26.10.501-dev"),
    /not published/,
  );
  assert.throws(
    () =>
      assertReleaseCoverage(
        [...releases, { tag_name: "v26.10.500-dev" }],
        snapshot,
      ),
    /missing published builds/,
  );
});

test("refresh failure cannot silently reuse an existing snapshot during release delivery", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("GitHub unavailable");
  });
  const previous = process.env.CHANGELOG_EXPECT_TAG;
  process.env.CHANGELOG_EXPECT_TAG = "v26.10.500-dev";
  try {
    await assert.rejects(generateChangelog(), /GitHub unavailable/);
  } finally {
    if (previous === undefined) delete process.env.CHANGELOG_EXPECT_TAG;
    else process.env.CHANGELOG_EXPECT_TAG = previous;
  }
});

test("recovers merged PR associations when custom squash messages omit numbers", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("/compare/"))
      return Response.json({
        commits: [
          { sha: "abc", commit: { message: "fix: preserve replay identity" } },
        ],
      });
    assert.match(url, /\/commits\/abc\/pulls/);
    return Response.json([
      { number: 1826, merged_at: "2026-09-06T17:59:48Z" },
      { number: 9999, merged_at: null },
    ]);
  });
  assert.deepEqual(
    await fetchComparePrNumbers("v26.9.501-dev", "v26.9.601-dev"),
    [1826],
  );
});

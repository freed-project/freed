import assert from "node:assert/strict";
import test from "node:test";

import { canonicalPreviousPublishedRelease } from "../release-receipt.mjs";
import {
  GITHUB_RELEASE_PAGE_MAX_BYTES,
  readGithubReleasePublications,
  resolveGithubReadToken,
} from "./github-release-publications.mjs";

function release(tag, overrides = {}) {
  return {
    id: tag,
    tag_name: tag,
    draft: false,
    prerelease: tag.endsWith("-dev"),
    published_at: "2026-07-27T12:00:00Z",
    ...overrides,
  };
}

test("GitHub release pagination accepts a page larger than one MiB within its bound", () => {
  const body = "x".repeat(1024 * 1024 + 64);
  let request = null;
  const releases = readGithubReleasePublications({
    environment: { GH_TOKEN: "fixture-token" },
    spawn: (command, args, options) => {
      request = { command, args, options };
      return {
        status: 0,
        stdout: JSON.stringify([release("v26.7.2700-dev", { body })]),
        stderr: "",
      };
    },
  });

  assert.equal(releases[0].body.length, body.length);
  assert.equal(request.command, "/usr/bin/curl");
  assert.equal(request.args[0], "--disable");
  assert.equal(request.options.maxBuffer, GITHUB_RELEASE_PAGE_MAX_BYTES);
  assert.equal(
    request.options.input,
    'header = "Authorization: Bearer fixture-token"\n',
  );
  assert.equal(request.args.includes("fixture-token"), false);
});

test("GitHub release pagination finds prior production after one hundred dev releases", () => {
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    release(`v26.7.${(2700 - index).toString().padStart(4, "0")}-dev`),
  );
  const secondPage = [release("v26.7.2600")];
  const pages = [firstPage, secondPage, firstPage, secondPage];
  let call = 0;
  const publicationFacts = readGithubReleasePublications({
    environment: { GH_TOKEN: "fixture-token" },
    spawn: () => ({
      status: 0,
      stdout: JSON.stringify(pages[call++]),
      stderr: "",
    }),
  });

  assert.equal(call, 4);
  assert.deepEqual(
    canonicalPreviousPublishedRelease({
      channel: "production",
      currentTag: "v26.7.2800",
      publicationFacts,
    }),
    {
      id: "v26.7.2600",
      tag: "v26.7.2600",
      publishedAt: "2026-07-27T12:00:00Z",
    },
  );
});

test("GitHub release pagination rejects duplicate publications and concurrent churn", () => {
  assert.throws(
    () =>
      readGithubReleasePublications({
        environment: { GH_TOKEN: "fixture-token" },
        spawn: () => ({
          status: 0,
          stdout: JSON.stringify([
            release("v26.7.2700-dev", { id: 1 }),
            release("v26.7.2700-dev", { id: 2 }),
          ]),
          stderr: "",
        }),
      }),
    /duplicate ID or tag/,
  );

  const snapshots = [
    [release("v26.7.2700-dev", { id: 1 })],
    [release("v26.7.2701-dev", { id: 2 })],
  ];
  let call = 0;
  assert.throws(
    () =>
      readGithubReleasePublications({
        environment: { GH_TOKEN: "fixture-token" },
        spawn: () => ({
          status: 0,
          stdout: JSON.stringify(snapshots[call++]),
          stderr: "",
        }),
      }),
    /changed while it was being read/,
  );
});

test("GitHub release reads fall back to gh auth token", () => {
  let invoked = false;
  const token = resolveGithubReadToken({
    environment: {},
    ghBinary: "/fixture/gh",
    execFile: (binary, args) => {
      invoked = true;
      assert.equal(binary, "/fixture/gh");
      assert.deepEqual(args, ["auth", "token"]);
      return "fallback-token\n";
    },
  });

  assert.equal(invoked, true);
  assert.equal(token, "fallback-token");
});

test("GitHub release reads fail closed without authenticated access", () => {
  assert.throws(
    () =>
      resolveGithubReadToken({
        environment: {},
        ghBinary: "/fixture/gh",
        execFile: () => {
          throw new Error("not logged in");
        },
      }),
    /Authenticated GitHub release reads require .*not logged in/,
  );
});

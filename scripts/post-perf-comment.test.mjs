import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPerfCommentBody,
  postPerfComment,
  shouldDowngradeCommentError,
  shouldSkipPerfComment,
} from "./post-perf-comment.mjs";

test("shouldSkipPerfComment skips non pull request runs", () => {
  assert.equal(
    shouldSkipPerfComment({
      eventName: "push",
      pullRequest: { number: 12, head: { repo: { full_name: "freed-project/freed" } } },
      repository: "freed-project/freed",
    }),
    "Skipping perf comment because this run is not a pull request.",
  );
});

test("shouldSkipPerfComment skips fork pull requests", () => {
  assert.equal(
    shouldSkipPerfComment({
      eventName: "pull_request",
      pullRequest: {
        number: 864,
        head: { repo: { full_name: "abramclark/freed" } },
      },
      repository: "freed-project/freed",
    }),
    "Skipping perf comment because abramclark/freed does not match freed-project/freed.",
  );
});

test("shouldSkipPerfComment allows same-repo pull requests", () => {
  assert.equal(
    shouldSkipPerfComment({
      eventName: "pull_request",
      pullRequest: {
        number: 872,
        head: { repo: { full_name: "freed-project/freed" } },
      },
      repository: "freed-project/freed",
    }),
    null,
  );
});

test("buildPerfCommentBody preserves the nightly post prefix", () => {
  assert.equal(
    buildPerfCommentBody("delta"),
    "(AI Generated).\n\n## Performance Benchmark Results\n\n```\ndelta\n```",
  );
});

test("shouldDowngradeCommentError only downgrades read-only integration failures", () => {
  assert.equal(shouldDowngradeCommentError(403, "Resource not accessible by integration"), true);
  assert.equal(shouldDowngradeCommentError(403, "Forbidden"), false);
  assert.equal(shouldDowngradeCommentError(500, "Resource not accessible by integration"), false);
});

test("postPerfComment sends an issue comment request", async () => {
  let request = null;
  await postPerfComment({
    owner: "freed-project",
    repo: "freed",
    issueNumber: 872,
    token: "token",
    body: "delta",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
      };
    },
  });

  assert.equal(request.url, "https://api.github.com/repos/freed-project/freed/issues/872/comments");
  assert.equal(request.init.method, "POST");
  assert.match(request.init.headers.authorization, /^Bearer token$/);
  assert.equal(
    JSON.parse(request.init.body).body,
    "(AI Generated).\n\n## Performance Benchmark Results\n\n```\ndelta\n```",
  );
});

test("postPerfComment surfaces GitHub API failures with response details", async () => {
  await assert.rejects(
    postPerfComment({
      owner: "freed-project",
      repo: "freed",
      issueNumber: 864,
      token: "token",
      body: "delta",
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({ message: "Resource not accessible by integration" }),
      }),
    }),
    /GitHub perf comment request failed with 403: Resource not accessible by integration/,
  );
});

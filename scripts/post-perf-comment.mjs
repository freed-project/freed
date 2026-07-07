import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function buildPerfCommentBody(body) {
  return `(AI Generated).\n\n## Performance Benchmark Results\n\n\`\`\`\n${body}\n\`\`\``;
}

export function shouldSkipPerfComment({ eventName, pullRequest, repository }) {
  if (eventName !== "pull_request") {
    return "Skipping perf comment because this run is not a pull request.";
  }

  const issueNumber = pullRequest?.number;
  if (!Number.isInteger(issueNumber)) {
    return "Skipping perf comment because the pull request payload did not include a number.";
  }

  const headRepository = pullRequest?.head?.repo?.full_name;
  if (headRepository && repository && headRepository !== repository) {
    return `Skipping perf comment because ${headRepository} does not match ${repository}.`;
  }

  return null;
}

export function shouldDowngradeCommentError(status, message = "") {
  return status === 403 && /resource not accessible by integration/i.test(message);
}

export async function postPerfComment({
  owner,
  repo,
  issueNumber,
  token,
  body,
  fetchImpl = globalThis.fetch,
}) {
  const response = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
        "user-agent": "freed-perf-comment",
      },
      body: JSON.stringify({ body: buildPerfCommentBody(body) }),
    },
  );

  if (response.ok) {
    return;
  }

  let errorMessage = response.statusText;
  try {
    const payload = await response.json();
    if (typeof payload?.message === "string" && payload.message) {
      errorMessage = payload.message;
    }
  } catch {
    // Keep the HTTP status text when the body is empty or invalid JSON.
  }

  const error = new Error(
    `GitHub perf comment request failed with ${response.status}: ${errorMessage}`,
  );
  error.status = response.status;
  error.responseMessage = errorMessage;
  throw error;
}

function appendStepSummary(message) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  fs.appendFileSync(summaryPath, `${message}\n`);
}

function readGitHubEvent(eventPath) {
  return JSON.parse(fs.readFileSync(eventPath, "utf8"));
}

async function main() {
  const comparisonPath = "perf-comparison.md";
  if (!fs.existsSync(comparisonPath)) {
    console.log("No perf comparison file found, skipping comment.");
    return;
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  const eventName = process.env.GITHUB_EVENT_NAME;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;

  if (!eventPath || !fs.existsSync(eventPath)) {
    console.log("No GitHub event payload found, skipping perf comment.");
    return;
  }

  if (!token) {
    console.log("No GitHub token found, skipping perf comment.");
    return;
  }

  const event = readGitHubEvent(eventPath);
  const skipReason = shouldSkipPerfComment({
    eventName,
    pullRequest: event.pull_request,
    repository,
  });

  if (skipReason) {
    console.log(skipReason);
    appendStepSummary(skipReason);
    return;
  }

  const [owner, repo] = String(repository ?? "").split("/");
  const body = fs.readFileSync(comparisonPath, "utf8");

  try {
    await postPerfComment({
      owner,
      repo,
      issueNumber: event.pull_request.number,
      token,
      body,
    });
    const successMessage = `Posted perf comparison comment to PR #${event.pull_request.number}.`;
    console.log(successMessage);
    appendStepSummary(successMessage);
  } catch (error) {
    if (shouldDowngradeCommentError(error.status, error.responseMessage)) {
      const warning = `Skipping perf comment after GitHub denied write access: ${error.responseMessage}.`;
      console.warn(warning);
      appendStepSummary(warning);
      return;
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  groupReleasesByDay,
  normalizeGitHubReleases,
  type ParsedRelease,
} from "../src/content/changelog";

const CHANGELOG_API_URL =
  "https://api.github.com/repos/freed-project/freed/releases?per_page=100";
const OUTPUT_PATH = join(
  process.cwd(),
  "src/content/changelog.generated.json",
);

async function fetchGitHubReleases(): Promise<ParsedRelease[]> {
  const response = await fetch(CHANGELOG_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub releases request failed: ${response.status} ${response.statusText}`,
    );
  }

  const releases = (await response.json()) as Array<{
    id: number;
    tag_name: string;
    body: string | null;
    published_at: string;
    html_url: string;
    draft: boolean;
    prerelease: boolean;
  }>;

  return groupReleasesByDay(normalizeGitHubReleases(releases));
}

function readExistingSnapshot(): ParsedRelease[] | null {
  if (!existsSync(OUTPUT_PATH)) {
    return null;
  }

  return JSON.parse(readFileSync(OUTPUT_PATH, "utf8")) as ParsedRelease[];
}

async function main() {
  try {
    const releases = await fetchGitHubReleases();
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(releases, null, 2)}\n`);
    console.log(
      `✓ Generated changelog snapshot with ${releases.length.toLocaleString()} day groups`,
    );
  } catch (error) {
    const existingSnapshot = readExistingSnapshot();
    if (existingSnapshot) {
      console.warn(
        `[generate-changelog] Using existing snapshot with ${existingSnapshot.length.toLocaleString()} day groups because refresh failed.`,
      );
      console.warn(error);
      return;
    }

    throw error;
  }
}

main().catch((error) => {
  console.error("[generate-changelog] Failed to build changelog snapshot.");
  console.error(error);
  process.exit(1);
});

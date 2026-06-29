import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(process.cwd(), "../..");
const searchFieldSource = readFileSync(
  join(repoRoot, "packages/ui/src/components/layout/SearchJumpField.tsx"),
  "utf8",
);
const searchHookSource = readFileSync(
  join(repoRoot, "packages/ui/src/hooks/useSearchResults.ts"),
  "utf8",
);

describe("feed search index lifecycle", () => {
  it("does not prewarm the full search index from an empty search field", () => {
    expect(searchFieldSource).not.toContain("prepareSearchIndex");
  });

  it("only builds the full search index after a non-empty query is active", () => {
    const effectBody = searchHookSource.match(
      /useEffect\(\(\) => \{[\s\S]*?\n  \}, \[accounts, items, searchCorpusVersion, trimmedQuery\]\);/,
    )?.[0] ?? "";

    expect(effectBody).toContain("if (!trimmedQuery)");
    expect(effectBody.indexOf("if (!trimmedQuery)")).toBeLessThan(
      effectBody.indexOf("prepareSearchIndex(items, searchCorpusVersion, accounts)"),
    );
  });
});

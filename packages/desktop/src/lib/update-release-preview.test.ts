import { describe, expect, it } from "vitest";
import { extractUpdatePreviewLine } from "./update-release-preview";

describe("extractUpdatePreviewLine", () => {
  it("returns the deck line from structured release notes", () => {
    const body = `(AI Generated).

## Freed v26.4.109

Map view, refined consent gates, and signed macOS installs

### Features

- Shared map and friends workspace
- Signed macOS installs
`;

    expect(extractUpdatePreviewLine(body)).toBe(
      "Map view, refined consent gates, and signed macOS installs",
    );
  });

  it("ignores later bullets and sections", () => {
    const body = `## Freed v26.3.2402

Friends view, contacts sync, and LinkedIn capture

### Features

- Friends view
- LinkedIn capture

### Fixes

- Desktop e2e mock repairs
`;

    expect(extractUpdatePreviewLine(body)).toBe(
      "Friends view, contacts sync, and LinkedIn capture",
    );
  });

  it("falls back to the first meaningful plain-text line for malformed markdown", () => {
    const body = `
Map view, refined consent gates, and signed macOS installs
Features
- Shared map and friends workspace
`;

    expect(extractUpdatePreviewLine(body)).toBe(
      "Map view, refined consent gates, and signed macOS installs",
    );
  });

  it("returns null when no meaningful preview line exists", () => {
    const body = `(AI Generated).

## Freed v26.4.109

### Features

- Shared map and friends workspace
`;

    expect(extractUpdatePreviewLine(body)).toBeNull();
  });
});

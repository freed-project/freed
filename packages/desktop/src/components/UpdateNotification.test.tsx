import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdateNotification } from "./UpdateNotification";

describe("UpdateNotification", () => {
  it("shows only the single release heading preview for an available update", () => {
    const html = renderToStaticMarkup(
      <UpdateNotification
        state={{
          phase: "available",
          update: {
            version: "26.4.109",
            body: `(AI Generated).

## Freed v26.4.109

Map view, refined consent gates, and signed macOS installs

### Features

- Shared map and friends workspace
- Signed macOS installs
`,
          } as never,
        }}
        onInstall={() => {}}
        onRelaunch={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(html).toContain("Update available, v26.4.109");
    expect(html).toContain("Map view, refined consent gates, and signed macOS installs");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("Shared map and friends workspace");
  });
});

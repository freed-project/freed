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
        releaseChannel="dev"
        onInstall={() => {}}
        onRelaunch={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(html).toContain("Update available on Dev, v26.4.109-dev");
    expect(html).toContain("Map view, refined consent gates, and signed macOS installs");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("Shared map and friends workspace");
  });

  it("renders the shared progress bar without width animation during downloads", () => {
    const html = renderToStaticMarkup(
      <UpdateNotification
        state={{ phase: "downloading", percent: 100 }}
        releaseChannel="production"
        onInstall={() => {}}
        onRelaunch={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(html).toContain("Downloading... 100%");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('style="width:100%"');
    expect(html).not.toContain("transition-[width]");
    expect(html).not.toContain("duration-300");
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdateProgressBar } from "@freed/ui/components/UpdateProgressBar";

describe("UpdateProgressBar", () => {
  it("renders a full-width fill at 100 percent without animation classes", () => {
    const html = renderToStaticMarkup(<UpdateProgressBar percent={100} />);

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('style="width:100%"');
    expect(html).toContain("theme-bg-surface");
    expect(html).toContain("theme-accent-primary");
    expect(html).not.toContain("transition-[width]");
    expect(html).not.toContain("duration-300");
  });

  it("clamps invalid percent values into the progress range", () => {
    const html = renderToStaticMarkup(<UpdateProgressBar percent={140} />);

    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('style="width:100%"');
  });
});

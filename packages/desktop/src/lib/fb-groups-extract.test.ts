import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = readFileSync(
  resolve(process.cwd(), "src-tauri/src/fb-groups-extract.js"),
  "utf8",
);

interface GroupsPayload {
  groups: Array<{ id: string; name: string; url: string }>;
  error?: string;
}

function runExtractor(html: string): GroupsPayload {
  let payload: GroupsPayload | null = null;
  document.body.innerHTML = html;
  (window as unknown as {
    __TAURI__: {
      event: {
        emit: (name: string, data: GroupsPayload) => void;
      };
    };
  }).__TAURI__ = {
    event: {
      emit: (name, data) => {
        if (name === "fb-groups-data") payload = data;
      },
    },
  };

  window.eval(script);

  if (!payload) throw new Error("Extractor did not emit group data");
  return payload;
}

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("facebook groups extractor", () => {
  it("chooses the real group name over activity-only links", () => {
    const payload = runExtractor(`
      <a href="https://www.facebook.com/groups/268672221985841">1d</a>
      <div role="listitem">
        <a href="https://www.facebook.com/groups/268672221985841?ref=bookmark">
          <span dir="auto">CDA Buy Trade Or Sell</span>
          <span>Last active about a minute ago</span>
        </a>
      </div>
    `);

    expect(payload.error).toBeUndefined();
    expect(payload.groups).toEqual([
      {
        id: "268672221985841",
        name: "CDA Buy Trade Or Sell Last active about a minute ago",
        url: "https://www.facebook.com/groups/268672221985841",
      },
    ]);
  });

  it("ignores group links that only expose timestamps or numeric IDs", () => {
    const payload = runExtractor(`
      <a href="https://www.facebook.com/groups/377650389038228">5m</a>
      <a href="https://www.facebook.com/groups/666662156765084">666662156765084</a>
      <a href="https://www.facebook.com/groups/feed">Groups feed</a>
    `);

    expect(payload.error).toBeUndefined();
    expect(payload.groups).toEqual([]);
  });

  it("uses nearby card text when the group link only exposes a timestamp", () => {
    const payload = runExtractor(`
      <div role="listitem">
        <a href="https://www.facebook.com/groups/07115243">1d</a>
        <span dir="auto">Bellingham Tool Library</span>
        <span>Last active a day ago</span>
      </div>
      <div role="listitem">
        <a href="https://www.facebook.com/groups/09712538">
          <img alt="Spokane Mutual Aid" />
        </a>
      </div>
    `);

    expect(payload.error).toBeUndefined();
    expect(payload.groups).toEqual([
      {
        id: "07115243",
        name: "Bellingham Tool Library Last active a day ago",
        url: "https://www.facebook.com/groups/07115243",
      },
      {
        id: "09712538",
        name: "Spokane Mutual Aid",
        url: "https://www.facebook.com/groups/09712538",
      },
    ]);
  });
});

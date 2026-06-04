import { afterEach, describe, expect, it } from "vitest";
import {
  finishBackgroundActivity,
  inferBackgroundActivityFromDebugEvent,
  recordBackgroundActivityLog,
  startBackgroundActivity,
  updateBackgroundActivity,
  useBackgroundActivityStore,
} from "./background-activity-store";

describe("background activity store", () => {
  afterEach(() => {
    useBackgroundActivityStore.getState().clearBackgroundActivity();
  });

  it("coalesces active records by stable id and clears them on finish", () => {
    const first = startBackgroundActivity({
      id: "channel:googleContacts",
      kind: "channel",
      channelId: "googleContacts",
      label: "Google Contacts",
      message: "Checking token.",
    });
    const second = startBackgroundActivity({
      id: "channel:googleContacts",
      kind: "channel",
      channelId: "googleContacts",
      label: "Google Contacts",
      message: "Fetching contacts.",
    });

    expect(first).toBe(second);
    expect(Object.values(useBackgroundActivityStore.getState().active)).toHaveLength(1);
    expect(useBackgroundActivityStore.getState().active[first]?.message).toBe("Fetching contacts.");

    finishBackgroundActivity(first, "success", "Google Contacts sync finished.");

    expect(Object.values(useBackgroundActivityStore.getState().active)).toHaveLength(0);
    expect(useBackgroundActivityStore.getState().log[0]).toMatchObject({
      level: "success",
      message: "Google Contacts sync finished.",
      channelId: "googleContacts",
    });
  });

  it("caps the rolling log and keeps newest entries first", () => {
    for (let index = 0; index < 225; index += 1) {
      recordBackgroundActivityLog({
        id: `entry:${index}`,
        ts: index,
        message: `entry ${index.toLocaleString()}`,
      });
    }

    const log = useBackgroundActivityStore.getState().log;
    expect(log).toHaveLength(200);
    expect(log[0]?.message).toBe("entry 224");
    expect(log.at(-1)?.message).toBe("entry 25");
  });

  it("updates progress without adding log noise unless requested", () => {
    const id = startBackgroundActivity({
      id: "job:update:desktop-download",
      kind: "job",
      jobKind: "update",
      label: "Update",
      message: "Downloading.",
      progress: 0,
    });

    updateBackgroundActivity(id, { progress: 50, message: "Halfway." });

    expect(useBackgroundActivityStore.getState().active[id]).toMatchObject({
      progress: 50,
      message: "Halfway.",
    });
    expect(useBackgroundActivityStore.getState().log).toHaveLength(1);

    updateBackgroundActivity(id, {
      progress: 100,
      message: "Ready.",
      log: true,
      level: "success",
    });

    expect(useBackgroundActivityStore.getState().log[0]).toMatchObject({
      level: "success",
      message: "Ready.",
      progress: 100,
    });
  });

  it("maps debug event prefixes to activity scopes", () => {
    expect(inferBackgroundActivityFromDebugEvent("change", "[FB] sync started")).toMatchObject({
      level: "info",
      channelId: "facebook",
    });
    expect(inferBackgroundActivityFromDebugEvent("error", "[Outbox] drain threw")).toMatchObject({
      level: "error",
      jobKind: "outbox",
    });
    expect(inferBackgroundActivityFromDebugEvent("change", "unscoped")).toBeNull();
  });
});

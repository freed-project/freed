import { describe, expect, it } from "vitest";
import {
  formatClockTime,
  formatDebugClockTime,
  formatMediumDateShortTime,
  formatMonthDayClockTime,
  formatShortClockTime,
} from "@freed/ui/lib/date-format";

describe("shared date formatters", () => {
  const timestamp = Date.UTC(2026, 4, 6, 15, 4, 5);

  it("matches the clock formats used by diagnostics surfaces", () => {
    expect(formatClockTime(timestamp)).toBe(
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(timestamp)),
    );
    expect(formatShortClockTime(timestamp)).toBe(
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(timestamp)),
    );
    expect(formatDebugClockTime(timestamp)).toBe(
      new Intl.DateTimeFormat(undefined, {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(timestamp)),
    );
  });

  it("matches the compact date and time formats used by settings surfaces", () => {
    expect(formatMonthDayClockTime(timestamp)).toBe(
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(timestamp)),
    );
    expect(formatMediumDateShortTime(timestamp)).toBe(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(timestamp)),
    );
  });
});

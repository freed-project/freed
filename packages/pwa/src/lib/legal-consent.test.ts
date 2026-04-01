import { beforeEach, describe, expect, it } from "vitest";
import {
  LEGAL_BUNDLE_VERSION,
  PROVIDER_RISK_VERSIONS,
  createAcceptanceRecord,
  isAcceptanceCurrent,
  readAcceptanceFromStorage,
  writeAcceptanceToStorage,
} from "@freed/shared";
import {
  acceptPwaBundle,
  getPwaBundleAcceptance,
  hasAcceptedPwaBundle,
} from "./legal-consent";

describe("legal consent helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("marks a matching legal bundle record as current", () => {
    const record = createAcceptanceRecord(
      LEGAL_BUNDLE_VERSION,
      "pwa-first-run",
      Date.now(),
    );

    expect(isAcceptanceCurrent(record, LEGAL_BUNDLE_VERSION)).toBe(true);
  });

  it("rejects stale provider risk versions", () => {
    const record = createAcceptanceRecord(
      "2026-03-01-x",
      "desktop-provider-x",
      Date.now(),
    );

    expect(isAcceptanceCurrent(record, PROVIDER_RISK_VERSIONS.x)).toBe(false);
  });

  it("treats malformed local storage as unaccepted", () => {
    window.localStorage.setItem("freed.legal.pwa.bundle", "{bad json");

    expect(getPwaBundleAcceptance()).toBeNull();
    expect(hasAcceptedPwaBundle()).toBe(false);
  });

  it("treats partial records as unaccepted", () => {
    window.localStorage.setItem(
      "freed.legal.pwa.bundle",
      JSON.stringify({ version: LEGAL_BUNDLE_VERSION }),
    );

    expect(getPwaBundleAcceptance()).toBeNull();
    expect(hasAcceptedPwaBundle()).toBe(false);
  });

  it("writes and reads acceptance records from storage", () => {
    const record = writeAcceptanceToStorage(
      window.localStorage,
      "freed.legal.example",
      LEGAL_BUNDLE_VERSION,
      "website-download",
    );

    expect(record.version).toBe(LEGAL_BUNDLE_VERSION);
    expect(
      readAcceptanceFromStorage(window.localStorage, "freed.legal.example"),
    ).toEqual(record);
  });

  it("stores PWA acceptance locally and recognizes the current bundle", () => {
    const record = acceptPwaBundle();

    expect(record.surface).toBe("pwa-first-run");
    expect(hasAcceptedPwaBundle()).toBe(true);
  });
});

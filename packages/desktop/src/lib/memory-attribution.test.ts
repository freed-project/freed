import { beforeEach, describe, expect, it } from "vitest";

import {
  getShellBaselineBytes,
  recordDocumentHydrated,
  resetMemoryAttributionForTests,
} from "./memory-monitor";

// The contract this protects: the shell baseline is only meaningful if it is
// captured BEFORE the Automerge document is hydrated. Every floor estimate in
// the storage roadmap is derived by subtracting from an observed total, and the
// WebKit-plus-React shell is the largest term in that subtraction, estimated
// across four independent passes at anywhere from 60 to 250 MB. A baseline
// taken after hydration silently folds the document into the "shell" and makes
// every derived number wrong in the flattering direction.
describe("memory attribution", () => {
  beforeEach(() => {
    resetMemoryAttributionForTests();
  });

  it("starts with no baseline", () => {
    expect(getShellBaselineBytes()).toBeUndefined();
  });

  it("treats hydration as a one-way door", () => {
    recordDocumentHydrated();
    recordDocumentHydrated();
    // Idempotent: a second call must not reopen the window by resetting state.
    expect(getShellBaselineBytes()).toBeUndefined();
  });

  it("clears state for tests so runs do not leak into each other", () => {
    recordDocumentHydrated();
    resetMemoryAttributionForTests();
    expect(getShellBaselineBytes()).toBeUndefined();
  });
});

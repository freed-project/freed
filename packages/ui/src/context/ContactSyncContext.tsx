/**
 * ContactSyncContext — shares the single useContactSync instance mounted in
 * AppShell with any descendant that needs it (primarily FriendsView).
 *
 * Mounting the hook at AppShell ensures the 15-minute interval and focus
 * listeners are active regardless of which view is currently visible.
 */

import { createContext, useContext } from "react";
import type {
  LibraryCoreDeviceContactStatusResponseV1,
  LibraryCoreDeviceContactSuggestionPageResponseV1,
  LibraryCoreDeviceContactUnmatchedPageResponseV1,
} from "@freed/shared/library-core";

export interface ContactSyncContextValue {
  syncState: LibraryCoreDeviceContactStatusResponseV1;
  suggestionPage: LibraryCoreDeviceContactSuggestionPageResponseV1;
  unmatchedPage: LibraryCoreDeviceContactUnmatchedPageResponseV1;
  syncNow: (
    options?: { force?: boolean },
  ) => Promise<LibraryCoreDeviceContactStatusResponseV1>;
  dismissSuggestion: (suggestionId: string) => Promise<void>;
  loadNextSuggestionPage: () => Promise<LibraryCoreDeviceContactSuggestionPageResponseV1>;
  loadNextUnmatchedPage: () => Promise<LibraryCoreDeviceContactUnmatchedPageResponseV1>;
  refreshReview: () => Promise<void>;
  resetSuggestionPage: () => Promise<LibraryCoreDeviceContactSuggestionPageResponseV1>;
  resetUnmatchedPage: () => Promise<LibraryCoreDeviceContactUnmatchedPageResponseV1>;
  openReview: () => Promise<void>;
}

export const ContactSyncContext = createContext<ContactSyncContextValue | null>(null);

export function useContactSyncContext(): ContactSyncContextValue {
  const ctx = useContext(ContactSyncContext);
  if (!ctx) {
    throw new Error("useContactSyncContext must be used within a ContactSyncContext.Provider");
  }
  return ctx;
}

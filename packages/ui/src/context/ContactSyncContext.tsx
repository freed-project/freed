/**
 * ContactSyncContext — shares the single useContactSync instance mounted in
 * AppShell with any descendant that needs it (primarily FriendsView).
 *
 * Mounting the hook at AppShell ensures the 15-minute interval and focus
 * listeners are active regardless of which view is currently visible.
 */

import { createContext, useContext } from "react";
import type { ContactSyncState } from "@freed/shared";

export interface ContactSyncContextValue {
  syncState: ContactSyncState;
  getSyncState: () => ContactSyncState;
  syncNow: () => Promise<ContactSyncState>;
  dismissMatch: (contactResourceName: string, friendIdOrAuthorId: string) => void;
}

export const ContactSyncContext = createContext<ContactSyncContextValue | null>(null);

export function useContactSyncContext(): ContactSyncContextValue {
  const ctx = useContext(ContactSyncContext);
  if (!ctx) {
    throw new Error("useContactSyncContext must be used within a ContactSyncContext.Provider");
  }
  return ctx;
}

import type { Account } from "@freed/shared";

export type AccountLabelSource = Pick<
  Account,
  "displayName" | "externalId" | "handle" | "provider"
>;

export function providerLabel(provider: Account["provider"]): string {
  if (provider === "x") return "X";
  if (provider === "google_contacts") return "Google Contacts";
  if (provider === "macos_contacts") return "Contacts";
  if (provider === "ios_contacts") return "Contacts";
  if (provider === "android_contacts") return "Contacts";
  if (provider === "web_contact") return "Manual contact";
  if (!provider) return "Account";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function accountTitle(account: AccountLabelSource): string {
  return account.displayName?.trim()
    || account.handle?.trim()
    || account.externalId?.trim()
    || providerLabel(account.provider);
}

export function accountSubtitle(account: AccountLabelSource): string {
  if (account.handle?.trim()) return account.handle;
  if (account.displayName?.trim()) return account.externalId?.trim() || providerLabel(account.provider);
  return providerLabel(account.provider);
}

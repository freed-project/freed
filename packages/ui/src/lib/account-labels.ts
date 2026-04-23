import type { Account } from "@freed/shared";

export function providerLabel(provider: Account["provider"]): string {
  if (provider === "x") return "X";
  if (provider === "google_contacts") return "Google Contacts";
  if (provider === "macos_contacts") return "Contacts";
  if (provider === "ios_contacts") return "Contacts";
  if (provider === "android_contacts") return "Contacts";
  if (provider === "web_contact") return "Manual contact";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function accountTitle(account: Account): string {
  return account.displayName ?? account.handle ?? account.externalId;
}

export function accountSubtitle(account: Account): string {
  if (account.handle?.trim()) return account.handle;
  if (account.displayName?.trim()) return account.externalId;
  return providerLabel(account.provider);
}

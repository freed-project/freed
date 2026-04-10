const AUTH_ERROR_PATTERNS = [
  /\b401\b/i,
  /\b403\b/i,
  /unauthorized/i,
  /could not authenticate/i,
  /invalid or expired token/i,
  /\bexpired\b/i,
  /\bnot logged in\b/i,
  /\blog in\b/i,
  /\bauth\b/i,
  /\bcookie\b/i,
  /\bsession\b/i,
  /\btoken\b/i,
];

export function needsProviderReconnect(error?: string | null): boolean {
  if (!error) return false;
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(error));
}

export function formatProviderReconnectMessage(
  providerLabel: string,
  error?: string | null,
): string {
  if (!error) {
    return `${providerLabel} needs to reconnect before sync can continue.`;
  }

  if (/expired|cookie|token|session/i.test(error)) {
    return `Your ${providerLabel} session expired. Reconnect to keep syncing.`;
  }

  if (/401|403|unauthorized|authenticate|not logged in|log in/i.test(error)) {
    return `${providerLabel} needs you to sign in again before sync can continue.`;
  }

  return error;
}

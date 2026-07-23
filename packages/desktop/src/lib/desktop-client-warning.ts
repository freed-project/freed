const DESKTOP_WARNING_ACK_KEY = "freed-multiple-desktop-warning-ack-v1";

export function desktopClientWarningSignature(ids: readonly string[]): string {
  return JSON.stringify([...ids].sort());
}

export function isDesktopClientWarningAcknowledged(signature: string): boolean {
  if (!signature || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DESKTOP_WARNING_ACK_KEY) === signature;
  } catch {
    return false;
  }
}

export function acknowledgeDesktopClientWarning(signature: string): void {
  if (!signature || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DESKTOP_WARNING_ACK_KEY, signature);
  } catch {
    // Callers still dismiss the warning for the current session.
  }
}

/** Let setup warn again after this device's local data is reset. */
export function clearDesktopClientWarningAcknowledgement(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DESKTOP_WARNING_ACK_KEY);
}

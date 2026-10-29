declare const __LIBRARY_TRANSFER_ENABLED__: boolean;
/** Compiled product capability, never a runtime or storage setting. */
export const LIBRARY_TRANSFER_ENABLED = typeof __LIBRARY_TRANSFER_ENABLED__ !== "undefined" && __LIBRARY_TRANSFER_ENABLED__;
export const LIBRARY_TRANSFER_UNAVAILABLE = "Primary transfer and consumer recovery are unavailable in this build. Existing transfer fences remain active; use a compatible recovery build.";
export function requireLibraryTransferCapability(): void {
  if (!LIBRARY_TRANSFER_ENABLED) throw new Error(LIBRARY_TRANSFER_UNAVAILABLE);
}

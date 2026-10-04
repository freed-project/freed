/** Per-device classifier selection, separate from synced summary preferences. */
export type JevClassifierProvider = "jev" | "gliclass-base";
const KEY = "freed-jev-classifier-provider-v1";
const listeners = new Set<() => void>();
export function getJevClassifierProvider(): JevClassifierProvider {
  try { return localStorage.getItem(KEY) === "gliclass-base" ? "gliclass-base" : "jev"; } catch { return "jev"; }
}
export function setJevClassifierProvider(provider: JevClassifierProvider): void {
  if (provider !== "jev" && provider !== "gliclass-base") throw new Error("Unknown classifier provider.");
  localStorage.setItem(KEY, provider);
  for (const listener of listeners) listener();
}
export function onJevClassifierProviderChange(listener: () => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}

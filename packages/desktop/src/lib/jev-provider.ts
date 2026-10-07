/** Per-device classifier selection, separate from synced summary preferences. */
export type JevClassifierProvider = "jev" | "gliclass-base" | "kev";
const KEY = "freed-jev-classifier-provider-v1";
const listeners = new Set<() => void>();
export function getJevClassifierProvider(): JevClassifierProvider {
  try { const value = localStorage.getItem(KEY); return value === "gliclass-base" || value === "kev" ? value : "jev"; } catch { return "jev"; }
}
export function setJevClassifierProvider(provider: JevClassifierProvider): void {
  if (provider !== "jev" && provider !== "gliclass-base" && provider !== "kev") throw new Error("Unknown classifier provider.");
  localStorage.setItem(KEY, provider);
  for (const listener of listeners) listener();
}
export function onJevClassifierProviderChange(listener: () => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}

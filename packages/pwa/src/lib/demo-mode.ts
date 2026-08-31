const DEMO_HOSTNAME = "demo.freed.wtf";

export function isFreedDemoHostname(hostname: string): boolean {
  return hostname.trim().toLowerCase() === DEMO_HOSTNAME;
}

export function isFreedDemoMode(
  hostname: string,
  explicitDemoBuild = import.meta.env.VITE_FREED_DEMO === "1",
): boolean {
  return explicitDemoBuild || isFreedDemoHostname(hostname);
}

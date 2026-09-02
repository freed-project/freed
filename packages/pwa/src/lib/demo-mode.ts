const DEMO_HOSTNAME = "demo.freed.wtf";

export function isFreedDemoHostname(hostname: string): boolean {
  return hostname.trim().toLowerCase() === DEMO_HOSTNAME;
}

/** Vercel previews exercise the form without creating real subscriptions. */
export function isFreedNewsletterPreviewHostname(hostname: string): boolean {
  return hostname.trim().toLowerCase().endsWith(".vercel.app");
}

export function isFreedDemoMode(
  hostname: string,
  explicitDemoBuild = import.meta.env.VITE_FREED_DEMO === "1",
): boolean {
  return explicitDemoBuild || isFreedDemoHostname(hostname);
}

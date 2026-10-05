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
  search = "",
): boolean {
  const explicitPreviewRequest =
    new URLSearchParams(search).get("freed-demo") === "1";
  return (
    explicitDemoBuild ||
    isFreedDemoHostname(hostname) ||
    (explicitPreviewRequest && isFreedNewsletterPreviewHostname(hostname))
  );
}

/** Keep an accepted preview demo in the same mode through navigation and reload. */
export function preserveFreedDemoNavigationUrl(path: string, entryUrl: string): string {
  const entry = new URL(entryUrl);
  if (!isFreedNewsletterPreviewHostname(entry.hostname) ||
      entry.searchParams.get("freed-demo") !== "1") return path;
  const next = new URL(path, entry.origin);
  next.searchParams.set("freed-demo", "1");
  return `${next.pathname}${next.search}`;
}

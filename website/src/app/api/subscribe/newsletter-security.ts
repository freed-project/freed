const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://freed.wtf",
  "https://www.freed.wtf",
  "https://app.freed.wtf",
  "https://dev-app.freed.wtf",
  "https://demo.freed.wtf",
]);

const DEFAULT_ALLOWED_TURNSTILE_HOSTNAMES = new Set([
  "freed.wtf",
  "www.freed.wtf",
  "app.freed.wtf",
  "dev-app.freed.wtf",
  "demo.freed.wtf",
]);

function configuredValues(value: string | undefined): Set<string> | null {
  if (!value?.trim()) return null;
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function isLocalDevelopmentOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

export function isAllowedNewsletterOrigin(
  origin: string,
  options: { configuredOrigins?: string; nodeEnv?: string } = {},
): boolean {
  if (!origin) return true;
  const configured = configuredValues(options.configuredOrigins);
  if ((configured ?? DEFAULT_ALLOWED_ORIGINS).has(origin)) return true;
  return options.nodeEnv !== "production" && isLocalDevelopmentOrigin(origin);
}

export function isAllowedTurnstileHostname(
  hostname: string | undefined,
  options: { configuredHostnames?: string; nodeEnv?: string } = {},
): boolean {
  if (!hostname) return false;
  const configured = configuredValues(options.configuredHostnames);
  if ((configured ?? DEFAULT_ALLOWED_TURNSTILE_HOSTNAMES).has(hostname))
    return true;
  return (
    options.nodeEnv !== "production" &&
    (hostname === "localhost" || hostname === "127.0.0.1")
  );
}

export function newsletterCorsHeaders(origin: string): Record<string, string> {
  return origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      }
    : {
        Vary: "Origin",
      };
}

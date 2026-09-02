import assert from "node:assert/strict";
import nextConfig from "../../../../next.config";
import {
  isAllowedNewsletterOrigin,
  isAllowedTurnstileHostname,
  newsletterCorsHeaders,
} from "./newsletter-security";
import { OPTIONS, POST } from "./route";

assert.equal(
  isAllowedNewsletterOrigin("https://app.freed.wtf", { nodeEnv: "production" }),
  true,
);
assert.equal(
  isAllowedNewsletterOrigin("https://attacker.example", {
    nodeEnv: "production",
  }),
  false,
);
assert.equal(
  isAllowedNewsletterOrigin("http://localhost:1421", {
    nodeEnv: "development",
  }),
  true,
);
assert.equal(
  isAllowedNewsletterOrigin("http://localhost:1421", { nodeEnv: "production" }),
  false,
);

assert.equal(
  isAllowedTurnstileHostname("app.freed.wtf", { nodeEnv: "production" }),
  true,
);
assert.equal(
  isAllowedTurnstileHostname("attacker.example", { nodeEnv: "production" }),
  false,
);
assert.equal(
  isAllowedTurnstileHostname("localhost", { nodeEnv: "development" }),
  true,
);
assert.equal(
  isAllowedTurnstileHostname("localhost", { nodeEnv: "production" }),
  false,
);

assert.deepEqual(newsletterCorsHeaders("https://app.freed.wtf"), {
  "Access-Control-Allow-Origin": "https://app.freed.wtf",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

const headerRules = await nextConfig.headers?.();
const embedFramePolicy = headerRules
  ?.find((rule) => rule.source === "/newsletter/embed")
  ?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
assert.match(embedFramePolicy ?? "", /(?:^|\s)http:\/\/tauri\.localhost(?:\s|$)/);
assert.match(embedFramePolicy ?? "", /(?:^|\s)https:\/\/tauri\.localhost(?:\s|$)/);

console.log("newsletter security contract passed");

const originalFetch = globalThis.fetch;
process.env.NODE_ENV = "production";
process.env.TURNSTILE_SECRET_KEY = "server-only-secret";
process.env.BREVO_API_KEY = "brevo-secret";
process.env.BREVO_LIST_ID = "42";

const calls: string[] = [];
globalThis.fetch = async (input) => {
  const url = String(input);
  calls.push(url);
  if (url.includes("siteverify")) {
    return Response.json({
      success: true,
      hostname: "app.freed.wtf",
      action: "newsletter_signup",
    });
  }
  return new Response(null, { status: 201 });
};

const appRequest = new Request("https://freed.wtf/api/subscribe", {
  method: "POST",
  headers: {
    Origin: "https://app.freed.wtf",
    "Content-Type": "application/json",
    "x-forwarded-for": "192.0.2.20",
  },
  body: JSON.stringify({
    email: "reader@example.com",
    name: "Reader Name",
    turnstileToken: "verified-token",
  }),
});
const appResponse = await POST(appRequest as Parameters<typeof POST>[0]);
assert.equal(appResponse.status, 200);
assert.equal(
  appResponse.headers.get("access-control-allow-origin"),
  "https://app.freed.wtf",
);
assert.equal(calls.length, 2);

const preflightResponse = await OPTIONS(
  new Request("https://freed.wtf/api/subscribe", {
    method: "OPTIONS",
    headers: { Origin: "https://app.freed.wtf" },
  }) as Parameters<typeof OPTIONS>[0],
);
assert.equal(preflightResponse.status, 204);
assert.equal(
  preflightResponse.headers.get("access-control-allow-origin"),
  "https://app.freed.wtf",
);

const attackerResponse = await POST(
  new Request("https://freed.wtf/api/subscribe", {
    method: "POST",
    headers: {
      Origin: "https://attacker.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "attacker@example.com",
      name: "Attacker",
      turnstileToken: "verified-token",
    }),
  }) as Parameters<typeof POST>[0],
);
assert.equal(attackerResponse.status, 403);
assert.equal(attackerResponse.headers.get("access-control-allow-origin"), null);
assert.equal(calls.length, 2);

globalThis.fetch = async (input) => {
  calls.push(String(input));
  return Response.json({ success: true, hostname: "app.freed.wtf" });
};
const actionlessResponse = await POST(
  new Request("https://freed.wtf/api/subscribe", {
    method: "POST",
    headers: {
      Origin: "https://app.freed.wtf",
      "Content-Type": "application/json",
      "x-forwarded-for": "192.0.2.22",
    },
    body: JSON.stringify({
      email: "actionless@example.com",
      name: "Actionless Attempt",
      turnstileToken: "verified-token",
    }),
  }) as Parameters<typeof POST>[0],
);
assert.equal(actionlessResponse.status, 400);

globalThis.fetch = async (input) => {
  calls.push(String(input));
  return Response.json({
    success: false,
    "error-codes": ["invalid-input-response"],
  });
};
const bypassResponse = await POST(
  new Request("https://freed.wtf/api/subscribe", {
    method: "POST",
    headers: {
      Origin: "https://app.freed.wtf",
      "Content-Type": "application/json",
      "x-forwarded-for": "192.0.2.21",
    },
    body: JSON.stringify({
      email: "bypass@example.com",
      name: "Bypass Attempt",
      turnstileToken: "turnstile-unavailable",
    }),
  }) as Parameters<typeof POST>[0],
);
assert.equal(bypassResponse.status, 400);
assert.equal(calls.filter((url) => url.includes("siteverify")).length, 3);

globalThis.fetch = originalFetch;
console.log("newsletter route contract passed");

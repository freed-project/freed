import { createSign } from "node:crypto";
import type { PrivateVulnerabilityReportPayload } from "../../shared/src/bug-report.js";
import { redactSensitiveText } from "../../shared/src/redact-sensitive.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const REPOSITORY_OWNER = "freed-project";
const REPOSITORY_NAME = "freed";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_TITLE_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 16 * 1024;
const MAX_STACK_LENGTH = 20 * 1024;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_REQUESTS = 3;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://app.freed.wtf",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

interface InstallationToken {
  token: string;
  expiresAt: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface ServerlessRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface JsonServerlessResponse {
  setHeader(name: string, value: string): void;
  status(code: number): JsonServerlessResponse;
  json(body: unknown): void;
  end(): void;
}

let cachedInstallationToken: InstallationToken | null = null;
const rateLimits = new Map<string, RateLimitEntry>();

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function allowedOrigins(): Set<string> {
  const configured = process.env.FREED_SECURITY_REPORT_ALLOWED_ORIGINS;
  if (!configured) return DEFAULT_ALLOWED_ORIGINS;
  return new Set(
    configured
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function requestOrigin(req: { headers?: Record<string, string | string[] | undefined> }): string {
  return headerValue(req.headers?.origin);
}

function requestIp(req: { headers?: Record<string, string | string[] | undefined> }): string {
  const forwarded =
    headerValue(req.headers?.["x-vercel-forwarded-for"]) ||
    headerValue(req.headers?.["x-forwarded-for"]);
  return forwarded.split(",")[0]?.trim() || "unknown";
}

function consumeRateLimit(ip: string, now = Date.now()): boolean {
  if (rateLimits.size > 5_000) {
    for (const [key, entry] of rateLimits) {
      if (entry.resetAt <= now) rateLimits.delete(key);
    }
  }
  const current = rateLimits.get(ip);
  if (!current || current.resetAt <= now) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= RATE_LIMIT_REQUESTS) return false;
  current.count += 1;
  return true;
}

function parseOptionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const redacted = redactSensitiveText(value.trim());
  if (redacted.length > maxLength) throw new Error(`${field} is too long.`);
  return redacted;
}

function parseFingerprint(value: unknown, field: string): string | undefined {
  const parsed = parseOptionalText(value, field, 128);
  if (!parsed) return undefined;
  if (!/^[a-f0-9]{8,128}$/i.test(parsed)) throw new Error(`${field} is invalid.`);
  return parsed;
}

function parseMetadata(value: unknown): Record<string, string | boolean> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("appMetadata must be an object.");
  }
  const allowed = new Set([
    "version",
    "releaseChannel",
    "buildKind",
    "commitSha",
    "commitRef",
    "deployedAt",
    "platform",
    "appMode",
  ]);
  const metadata: Record<string, string | boolean> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    if (typeof candidate === "boolean") {
      metadata[key] = candidate;
      continue;
    }
    if (typeof candidate !== "string") throw new Error(`appMetadata.${key} is invalid.`);
    metadata[key] = redactSensitiveText(candidate.slice(0, 512));
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function parsePrivateReportPayload(value: unknown): PrivateVulnerabilityReportPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The report body must be a JSON object.");
  }
  const body = value as Record<string, unknown>;
  const title = parseOptionalText(body.title, "title", MAX_TITLE_LENGTH);
  const description = parseOptionalText(
    body.description,
    "description",
    MAX_DESCRIPTION_LENGTH,
  );
  if (!title) throw new Error("title is required.");
  if (!description) throw new Error("description is required.");
  return {
    title,
    description,
    stackTrace: parseOptionalText(body.stackTrace, "stackTrace", MAX_STACK_LENGTH),
    componentStack: parseOptionalText(
      body.componentStack,
      "componentStack",
      MAX_STACK_LENGTH,
    ),
    crashFingerprint: parseFingerprint(body.crashFingerprint, "crashFingerprint"),
    stackFingerprint: parseFingerprint(body.stackFingerprint, "stackFingerprint"),
    appMetadata: parseMetadata(body.appMetadata),
  };
}

function indentedBlock(value: string): string {
  return value
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

export function formatPrivateReportDescription(
  payload: PrivateVulnerabilityReportPayload,
): string {
  const sections = [payload.description];
  const metadata = payload.appMetadata
    ? Object.entries(payload.appMetadata).map(([key, value]) => `- ${key}: ${String(value)}`)
    : [];
  const fingerprints = [
    payload.crashFingerprint ? `- Crash fingerprint: ${payload.crashFingerprint}` : null,
    payload.stackFingerprint ? `- Stack fingerprint: ${payload.stackFingerprint}` : null,
  ].filter((value): value is string => Boolean(value));
  if (metadata.length > 0 || fingerprints.length > 0) {
    sections.push(["## Redacted runtime details", ...metadata, ...fingerprints].join("\n"));
  }
  if (payload.stackTrace) {
    sections.push(`## Redacted stack trace\n\n${indentedBlock(payload.stackTrace)}`);
  }
  if (payload.componentStack) {
    sections.push(`## Redacted component stack\n\n${indentedBlock(payload.componentStack)}`);
  }
  sections.push(
    "The Freed reporting bridge applied client-side and server-side secret redaction. The diagnostic zip was not uploaded.",
  );
  return sections.join("\n\n");
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createGitHubAppJwt(appId: string, privateKey: string, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000) - 60;
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({ iat: issuedAt, exp: issuedAt + 600, iss: appId });
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey.replace(/\\n/g, "\n"), "base64url");
  return `${unsigned}.${signature}`;
}

async function installationToken(): Promise<string> {
  if (
    cachedInstallationToken &&
    cachedInstallationToken.expiresAt - TOKEN_REFRESH_SKEW_MS > Date.now()
  ) {
    return cachedInstallationToken.token;
  }
  const appId = process.env.FREED_SECURITY_REPORT_APP_ID;
  const installationId = process.env.FREED_SECURITY_REPORT_INSTALLATION_ID;
  const privateKey = process.env.FREED_SECURITY_REPORT_PRIVATE_KEY;
  if (!appId || !installationId || !privateKey) {
    throw new Error("The private reporting bridge is not configured.");
  }
  const response = await fetch(
    `${GITHUB_API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${createGitHubAppJwt(appId, privateKey)}`,
        "x-github-api-version": GITHUB_API_VERSION,
      },
      body: JSON.stringify({
        repositories: [REPOSITORY_NAME],
        permissions: { repository_advisories: "write" },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = (await response.json().catch(() => null)) as
    | { token?: unknown; expires_at?: unknown }
    | null;
  if (
    !response.ok ||
    typeof body?.token !== "string" ||
    typeof body.expires_at !== "string"
  ) {
    throw new Error(`GitHub App authentication failed with status ${response.status}.`);
  }
  const expiresAt = Date.parse(body.expires_at);
  if (!Number.isFinite(expiresAt)) throw new Error("GitHub returned an invalid token expiry.");
  cachedInstallationToken = { token: body.token, expiresAt };
  return body.token;
}

async function submitToGitHub(payload: PrivateVulnerabilityReportPayload) {
  const token = await installationToken();
  const response = await fetch(
    `${GITHUB_API}/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/security-advisories`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": GITHUB_API_VERSION,
      },
      body: JSON.stringify({
        summary: payload.title,
        description: formatPrivateReportDescription(payload),
        vulnerabilities: [],
        severity: null,
        start_private_fork: false,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = (await response.json().catch(() => null)) as
    | { html_url?: unknown }
    | null;
  if (!response.ok || typeof body?.html_url !== "string") {
    throw new Error(`GitHub rejected the private advisory with status ${response.status}.`);
  }
  return { advisoryUrl: body.html_url };
}

function setResponseHeaders(
  res: { setHeader: (name: string, value: string) => void },
  origin: string,
) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("vary", "Origin");
  if (allowedOrigins().has(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
  }
}

export default async function handler(
  req: ServerlessRequest,
  res: JsonServerlessResponse,
): Promise<void> {
  const origin = requestOrigin(req);
  setResponseHeaders(res, origin);
  if (req.method === "OPTIONS") {
    if (!allowedOrigins().has(origin)) return res.status(403).json({ error: "Origin rejected." });
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!allowedOrigins().has(origin)) return res.status(403).json({ error: "Origin rejected." });
  const contentType = headerValue(req.headers?.["content-type"]);
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return res.status(415).json({ error: "Content type must be application/json." });
  }
  const contentLength = Number(headerValue(req.headers?.["content-length"]));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return res.status(413).json({ error: "Report is too large." });
  }
  if (!consumeRateLimit(requestIp(req))) {
    res.setHeader("retry-after", String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)));
    return res.status(429).json({ error: "Too many private reports. Try again later." });
  }
  try {
    const rawBody = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const payload = parsePrivateReportPayload(rawBody);
    const result = await submitToGitHub(payload);
    return res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Private report submission failed.";
    const clientError = /(?:required|invalid|too long|must be|JSON object)/i.test(message);
    if (!clientError) console.error("Private report bridge failure", { message });
    return res.status(clientError ? 400 : 502).json({
      error: clientError ? message : "The private report could not be submitted securely.",
    });
  }
}

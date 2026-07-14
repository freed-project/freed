import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redactSensitiveText } from "@freed/shared/redact-sensitive";
import handler, {
  createGitHubAppJwt,
  formatPrivateReportDescription,
  parsePrivateReportPayload,
} from "../../api/security-report";

function createResponse() {
  const headers = new Map<string, string>();
  const state: { status: number; body: unknown } = { status: 200, body: null };
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    status(status: number) {
      state.status = status;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
    end() {
      return response;
    },
  };
  return { response, state, headers };
}

describe("private security report API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FREED_SECURITY_REPORT_APP_ID;
    delete process.env.FREED_SECURITY_REPORT_INSTALLATION_ID;
    delete process.env.FREED_SECURITY_REPORT_PRIVATE_KEY;
  });

  it.each([
    ["token=super-secret", "token=[REDACTED]"],
    ["https://user:password@example.com/path", "https://[REDACTED]@example.com/path"],
    ["/Users/alice/project/app.ts", "/Users/[REDACTED]/project/app.ts"],
    ["C:\\Users\\alice\\project\\app.ts", "C:\\Users\\[REDACTED]\\project\\app.ts"],
    ["reporter@example.com", "[REDACTED_EMAIL]"],
    ["github_pat_123456789012345678901234567890", "[REDACTED_GITHUB_TOKEN]"],
    ["AKIA1234567890ABCDEF", "[REDACTED_AWS_KEY]"],
  ])("redacts sensitive diagnostic text in %s", (input, expected) => {
    expect(redactSensitiveText(input)).toBe(expected);
  });

  it("redacts private key blocks in linear time under repeated headers", () => {
    const repeatedHeaders = "-----BEGIN PRIVATE KEY-----\n".repeat(20_000);
    const input = `before\n${repeatedHeaders}payload\n-----END PRIVATE KEY-----\nafter`;

    expect(redactSensitiveText(input)).toBe(
      "before\n[REDACTED_PRIVATE_KEY]\nafter",
    );
  });

  it.each(["", "RSA ", "EC ", "OPENSSH "])(
    "redacts %sprivate key blocks",
    (keyType) => {
      const input = `before\n-----BEGIN ${keyType}PRIVATE KEY-----\nsecret\n-----END ${keyType}PRIVATE KEY-----\nafter`;

      expect(redactSensitiveText(input)).toBe(
        "before\n[REDACTED_PRIVATE_KEY]\nafter",
      );
    },
  );

  it("preserves an incomplete private key marker", () => {
    const input = "before\n-----BEGIN PRIVATE KEY-----\nincomplete";

    expect(redactSensitiveText(input)).toBe(input);
  });

  it("redacts payloads again at the server boundary", () => {
    const payload = parsePrivateReportPayload({
      title: "Token leak",
      description: "authorization: Bearer a-secret-token",
      stackTrace: "at /home/alice/app.ts?key=secret-value",
      crashFingerprint: "deadbeef",
      appMetadata: { version: "1.2.3", userAgent: "not accepted" },
    });

    expect(payload.description).toBe("authorization=[REDACTED]");
    expect(payload.stackTrace).toContain("/home/[REDACTED]/app.ts?key=[REDACTED]");
    expect(payload.appMetadata).toEqual({ version: "1.2.3" });
    const formatted = formatPrivateReportDescription(payload);
    expect(formatted).toContain("## Redacted stack trace");
    expect(formatted).toContain("diagnostic zip was not uploaded");
    expect(formatted).not.toContain("alice");
    expect(formatted).not.toContain("secret-value");
  });

  it("creates a ten minute RS256 GitHub App JWT", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const now = 1_800_000_000_000;
    const jwt = createGitHubAppJwt(
      "1234",
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      now,
    );
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toEqual({
      iat: Math.floor(now / 1000) - 60,
      exp: Math.floor(now / 1000) + 540,
      iss: "1234",
    });
    expect(signature).toBeTruthy();
  });

  it("rejects untrusted origins before contacting GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { response, state } = createResponse();

    await handler(
      {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.10",
        },
        body: { title: "A", description: "B" },
      },
      response,
    );

    expect(state.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a repository-scoped installation token and submits one advisory", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.FREED_SECURITY_REPORT_APP_ID = "1234";
    process.env.FREED_SECURITY_REPORT_INSTALLATION_ID = "5678";
    process.env.FREED_SECURITY_REPORT_PRIVATE_KEY = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "installation-token",
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            html_url:
              "https://github.com/freed-project/freed/security/advisories/GHSA-abcd-1234-efgh",
          }),
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { response, state, headers } = createResponse();

    await handler(
      {
        method: "POST",
        headers: {
          origin: "https://app.freed.wtf",
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.11",
        },
        body: {
          title: "Sensitive failure",
          description: "Reproduction details",
          stackTrace: "at capture (app.ts:10:2)",
        },
      },
      response,
    );

    expect(state.status).toBe(201);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const tokenRequest = fetchMock.mock.calls[0]!;
    expect(tokenRequest[0]).toBe(
      "https://api.github.com/app/installations/5678/access_tokens",
    );
    expect(JSON.parse(String(tokenRequest[1]?.body))).toEqual({
      repositories: ["freed"],
      permissions: { repository_advisories: "write" },
    });
    const reportRequest = fetchMock.mock.calls[1]!;
    expect(reportRequest[0]).toBe(
      "https://api.github.com/repos/freed-project/freed/security-advisories",
    );
    const reportBody = JSON.parse(String(reportRequest[1]?.body));
    expect(reportBody.summary).toBe("Sensitive failure");
    expect(reportBody.description).toContain("## Redacted stack trace");
    expect(reportBody.vulnerabilities).toEqual([]);
    expect(reportBody.severity).toBeNull();
    expect(reportBody.start_private_fork).toBe(false);
  });
});

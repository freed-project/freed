# Private Vulnerability Reporting

Freed can send a user-initiated vulnerability report from Freed Desktop or the
PWA to the private vulnerability inbox for `freed-project/freed`.

## Data flow

1. The report composer collects the user's title and description.
2. Private diagnostics remain opt-in. Only selected stack traces and a small
   allowlist of build metadata are eligible for submission.
3. The client redacts credentials, tokens, private keys, home directory names,
   email addresses, and sensitive URL parameters.
4. The reporting endpoint validates the origin, size, shape, and rate limit,
   then applies the same redaction again.
5. The endpoint creates a private draft security advisory through a repository
   scoped GitHub App installation token. GitHub's researcher report endpoint
   returns HTTP 500 for installation tokens even though its API documentation
   lists them as supported. A direct draft advisory reaches the same internal
   security team without misrepresenting the App as a human reporter.

The diagnostic zip is never sent through this bridge. It stays on the user's
device for manual review and a separate support exchange if needed.

The bridge does not submit in the background and does not retry failed reports.
One explicit click produces at most one GitHub advisory request.

## GitHub App

Use a dedicated GitHub App installed only on `freed-project/freed`. Grant only
the repository permission `Repository security advisories: Read and write`.
Do not grant organization permissions, contents access, issues access, or
webhook delivery.

Configure these server-side environment variables:

| Variable | Purpose |
| --- | --- |
| `FREED_SECURITY_REPORT_APP_ID` | GitHub App identifier |
| `FREED_SECURITY_REPORT_INSTALLATION_ID` | Installation identifier for the Freed repository |
| `FREED_SECURITY_REPORT_PRIVATE_KEY` | PEM private key for the GitHub App |
| `FREED_SECURITY_REPORT_ALLOWED_ORIGINS` | Optional comma-separated replacement for the built-in Freed origins |

The endpoint exchanges a short-lived app JWT for a one-hour installation token.
The exchange narrows the token to the `freed` repository and the advisory write
permission. A token is cached only in server memory and refreshed before expiry.

## Abuse controls

The endpoint accepts JSON bodies no larger than 64 KB and limits each observed
client address to three attempts per 15 minutes on a warm server instance. The
production deployment should also enforce an edge rate limit for
`/api/security-report`, because an in-memory serverless limit is not a complete
distributed abuse control.

GitHub may reject abusive or invalid submissions. The endpoint returns a generic
failure to the client and does not expose GitHub credentials or response bodies.

## Verification

Before enabling the production route:

1. Install the dedicated App only on the Freed repository.
2. Add the environment variables without exposing the private key to build logs.
3. Apply an edge rate limit to `/api/security-report`.
4. Submit a test report containing fake secrets and a fake stack trace.
5. Confirm the private draft advisory appears under the repository Security tab.
6. Confirm the fake secrets are redacted and no zip attachment exists.
7. Close the test advisory and record the test date in the release evidence.

To disable the bridge, remove the App installation or its private key from the
deployment environment. The report composer will keep local bundle download and
email paths available.

# Security Audit, July 13, 2026

## Scope

The `freed-project` organization controls one GitHub repository, the public
`freed-project/freed` monorepo. The audit covered organization policy,
repository security settings, Actions, release environments, dependencies,
CodeQL results, credential storage, user-controlled network access, parser
boundaries, and private vulnerability intake.

The repository is public, but the product handles OAuth tokens, API keys,
authenticated provider sessions, local content, and diagnostic data. Those
assets make the product security boundary larger than the repository visibility
suggests.

## Live GitHub posture

| Control | Before audit | Current state |
| --- | --- | --- |
| Organization two-factor requirement | Enabled | Enabled |
| Default repository permission | Read | Read |
| Organization security baseline | Missing | Enforced on `freed` and the default for all new repositories |
| Private vulnerability reporting | Disabled | Enabled |
| Private reporting GitHub App | Missing | Installed only on `freed` with advisory write and metadata read |
| Dependabot security updates | Disabled | Enabled |
| Secret scanning | Disabled | Enabled |
| Push protection | Disabled | Enabled |
| CodeQL default setup | Missing | Enabled with the extended suite for Actions, JavaScript, TypeScript, and Rust |
| Actions allowlist | All actions | GitHub-owned and verified actions only |
| Immutable Action references | Disabled | Workflow files pinned in this change, repository enforcement waits for merge |
| Branch rulesets | None | Governed rules exist in the repository, but live activation still needs a distinct publisher identity and owner-reviewed evidence |
| Production environment protection | None | Still open, because applying approval gates to Vercel-created environments without confirming their branch mapping could stop production deployments |

Secret scanning found no open alerts after enablement. The enforced `Freed
security baseline` enables validity checks, non-provider patterns, generic
secret detection, extended metadata, Dependabot security updates, CodeQL
default setup, push protection, and private vulnerability reporting. It is
attached to `freed` and applies by default to every new repository type.

## Material findings

### High: Desktop secrets are not consistently encrypted at rest

Cloud OAuth access and refresh tokens are stored in renderer `localStorage`.
The shared `secure-storage.ts` wrapper also states that `tauri-plugin-store`
encrypts `secure.json`, but Tauri Store is persistent key-value storage, not an
encrypted secret vault. API keys saved through that wrapper should therefore
be treated as clear text at rest.

Remediation requires a separate Desktop migration to Tauri Stronghold or an OS
credential vault, removal of legacy clear-text values after successful import,
failure-safe rollback, and tests covering upgrade, disconnect, and recovery.
This bridge change does not disguise the storage bug with a comment edit.

### High: The PWA article proxy allowed server-side requests to private networks

The article proxy accepted an arbitrary URL and followed the runtime fetch
stack without validating DNS results or redirects. A caller could attempt to
reach loopback, private, link-local, or cloud metadata addresses through the
Vercel function.

This change resolves every destination, rejects mixed public and private DNS
answers, pins the validated address into the connection, revalidates up to
three redirects, rejects non-HTML responses, caps bodies at 2 MB, and avoids
returning upstream error details. Focused tests cover private IPv4, private
IPv6, mapped IPv4, mixed DNS, redirects, rebinding resistance, content type,
and response size.

### High: Dependency backlog included exploitable production packages

The live default branch had 91 Dependabot alerts: 2 critical, 39 high, 36
medium, and 14 low. Fifty affected runtime dependencies. The lockfile and safe
direct dependency upgrades in this change reduce the local npm audit result to
six moderate findings, with no critical or high findings.

The remaining moderate findings are constrained as follows:

- Automerge and `vite-plugin-top-level-await` retain a transitive `uuid` issue
  with no compatible upstream fix. The vulnerable operation requires callers
  to supply a destination buffer. Freed does not intentionally expose that
  operation to untrusted input.
- The website lane retains a Next-bundled PostCSS advisory. npm proposes an
  invalid downgrade as its automatic fix. The website dependency must be
  updated and validated separately from the product lane.

### Medium: XML entity expansion was unbounded

RSS and OPML parsing accepted XML entity declarations without explicit size,
depth, count, or expanded-output limits. This change upgrades the parser and
adds finite entity limits with tests for normal entities and malicious
expansion.

### Medium: Dynamic property writes need prototype-key guards

CodeQL identified 36 related property injection and prototype pollution paths,
primarily in Automerge schema mutation helpers. Many keys are IDs in intentional
record maps, but some can originate in imported or synced data. Every dynamic
write should reject `__proto__`, `prototype`, and `constructor` before touching
a normal JavaScript object. That remediation belongs in a focused shared-schema
change with sync compatibility tests.

### Medium: Untrusted text reaches costly regular expressions

CodeQL identified 16 polynomial regular expression paths across RSS
normalization, Markdown import, Facebook status parsing, and content signals.
The RSS and Markdown paths process externally supplied or imported text and
deserve bounded input sizes plus linear parsing or proven-safe expressions.
These should be remediated in a focused parser hardening change.

CodeQL also flagged the bridge's initial private-key block expression before
publication. This change replaces it with a bounded linear scanner and covers
all supported key formats, incomplete markers, and 20,000 repeated headers.

### Medium: Provider URL recognition uses substring checks

Sixteen findings use URL substrings such as `youtube.com` or `facebook.com`
instead of parsed hostname equality or suffix-bound checks. Most only influence
classification or deduplication, but native extraction paths should not accept
lookalike hosts. Replace them with one shared hostname matcher and test apex,
subdomain, lookalike, credential, and malformed URL cases.

## CodeQL disposition

The first extended CodeQL run produced 125 open alerts. Scanner volume is not a
vulnerability count. The grouped disposition is:

| Alert class | Count | Disposition |
| --- | ---: | --- |
| Unpinned Actions and missing workflow permissions | 12 | Fixed in this change |
| Clear-text storage | 8 | Two confirmed cloud token paths, six auth-state or redirect metadata false positives |
| Property injection and prototype pollution | 36 | Defense required for imported and synced keys |
| Polynomial regular expressions | 16 | Parser hardening required |
| Provider URL substring and anchor checks | 22 | Shared hostname parsing required, two alerts are test-only |
| File race and temporary-file handling | 14 | Local automation paths need atomic-open review, two are test or bounded local cases |
| Network data and local files crossing boundaries | 10 | Expected release and test tooling, path and destination constraints need verification |
| Worker message origin checks | 4 | False positives for dedicated workers, which do not accept arbitrary window senders |
| Clear-text cookie | 1 | False positive in a test fixture using a fake cookie |
| Insecure randomness | 1 | Non-security runtime event identifier, use `crypto.randomUUID()` for clean intent |
| Double escaping | 1 | RSS normalization correctness review required |

Alerts should be closed only after the fixing commit lands or a reviewed false
positive explanation is recorded. Bulk dismissal would convert uncertainty into
green paint.

## Private vulnerability report bridge

The new bridge sends only user-initiated, redacted text and selected stack
traces to a private draft GitHub security advisory. GitHub's researcher report
endpoint returned HTTP 500 for a valid installation token despite documenting
that token type as supported, while the maintainer draft advisory endpoint
accepted the same repository-scoped App token. Redaction occurs on both the
client and server. Runtime metadata is allowlisted. Request size, origin, and
warm-instance rate limits are enforced. The GitHub App token is restricted to
the `freed` repository and repository advisory write permission. There is no
background submission and no automatic retry. The diagnostic zip stays on the
user's device.

The App is installed only on `freed`. Its App ID and installation ID are stored
in all three PWA deployment environments. The private key is encrypted in
Production and Preview only. Development has no advisory-writing credential. A
production Vercel Firewall rule limits `/api/security-report` to five requests
per hour per client address.

Production activation still requires:

1. Merge and deploy this change.
2. Submit a fake-secret smoke report and verify redaction in the private
   advisory inbox.

## Ordered follow-up work

1. Migrate Desktop OAuth tokens and API keys to encrypted native storage.
2. Guard dynamic record keys across shared schema and worker mutations.
3. Replace provider substring recognition with shared parsed-host matching.
4. Remove the remaining polynomial regular expression paths and bound imported
   text.
5. Review local automation file opens for atomic creation and no-follow safety.
6. Update the website's Next and PostCSS chain in the `www` lane.
7. Establish a distinct pull request publisher identity, produce one
   owner-reviewed evidence pull request, then activate the checked-in branch
   rulesets.
8. Add production environment branch restrictions after mapping each
   Vercel-created environment to its actual release lane.

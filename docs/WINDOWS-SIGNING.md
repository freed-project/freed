# Windows Signing Plan

Freed Desktop currently ships unsigned Windows installers. Users can still
install them, but Windows SmartScreen can warn before launch. This document
memorializes the implementation path for signing Windows release artifacts
with Microsoft Artifact Signing.

This is not live yet. The release workflow must not be changed to invoke this
path until the Azure resources and GitHub configuration below exist.

## Chosen Provider

Use Microsoft Artifact Signing, formerly Trusted Signing.

Reasons:

- Microsoft manages the signing certificate and private key.
- GitHub Actions can authenticate with OpenID Connect instead of a long-lived
  client secret.
- The service is designed for Windows SmartScreen, Smart App Control, and
  public trust code signing.
- The Basic plan is currently listed by Microsoft as `$9.99/month` for up to
  `5,000` signatures, plus `$0.005` for each additional signature.

References:

- Microsoft Artifact Signing overview: `https://azure.microsoft.com/en-us/products/artifact-signing/`
- Microsoft signing integrations: `https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations`
- Microsoft GitHub Action: `https://github.com/marketplace/actions/trusted-signing`
- Tauri Windows signing: `https://v2.tauri.app/distribute/sign/windows/`

## Azure Setup

Create these Azure resources before touching the live release workflow:

1. Artifact Signing account.
2. Public Trust certificate profile for Freed.
3. Microsoft Entra app registration for GitHub Actions.
4. Federated credential for this repository and the release workflow.
5. Role assignment granting the app registration `Trusted Signing Certificate
   Profile Signer` on the certificate profile.

Use OpenID Connect. Do not add `AZURE_CLIENT_SECRET` unless OIDC cannot be
made to work. If a client secret is used as a temporary fallback, document the
expiration date in this file and remove it after OIDC works.

## GitHub Configuration

Add these repository variables or secrets after Azure provisioning:

| Name | Purpose |
| ---- | ------- |
| `AZURE_TENANT_ID` | Microsoft Entra tenant ID. |
| `AZURE_CLIENT_ID` | App registration client ID for GitHub Actions OIDC. |
| `WINDOWS_TRUSTED_SIGNING_ACCOUNT_NAME` | Artifact Signing account name. |
| `WINDOWS_TRUSTED_SIGNING_CERT_PROFILE` | Public Trust certificate profile name. |
| `WINDOWS_TRUSTED_SIGNING_ENDPOINT` | Region endpoint, for example `https://eus.codesigning.azure.net/`. |

Keep these values in GitHub Actions repository secrets unless there is a clear
reason to make the non-sensitive values repository variables.

## Repo Scaffold

The placeholder script lives at:

```text
packages/desktop/src-tauri/scripts/sign-windows.ps1
```

It documents the Tauri `signCommand` contract and validates the required
environment variables, but it is intentionally not wired into
`tauri.conf.json` yet. That keeps the current Windows release path unchanged.

When Azure provisioning is done, activate signing by adding a Windows bundle
section similar to:

```json
{
  "bundle": {
    "windows": {
      "signCommand": "powershell -ExecutionPolicy Bypass -File ./scripts/sign-windows.ps1 %1"
    }
  }
}
```

Tauri replaces `%1` with the artifact path that must be signed.

## Future Workflow Changes

Only make these changes after the Azure resources exist:

1. Add a Windows signing secret validation step before `tauri-action`.
2. Give the release job `id-token: write` permissions if the workflow does not
   already have them.
3. Authenticate to Azure with OIDC on `windows-latest`.
4. Install or prepare the Microsoft Artifact Signing tools required by the
   selected signing path.
5. Pass the Windows signing environment variables into the `tauri-action` step.
6. Wire `bundle.windows.signCommand` to `sign-windows.ps1`.

Do not sign only the uploaded installer after the Tauri build. The goal is to
sign the artifacts during bundling so the app binary and NSIS installer are
covered by the release pipeline.

## Verification

After activation, cut a throwaway release tag and verify the Windows job:

1. The Windows build validates signing inputs before bundling.
2. The signing command runs for the executable artifacts Tauri passes to it.
3. The release contains `Freed-Windows-x64-setup.exe`.
4. A clean Windows machine reports a valid Authenticode signature:

```powershell
Get-AuthenticodeSignature .\Freed-Windows-x64-setup.exe | Format-List
```

The expected result is `Status: Valid` with a signer matching the Artifact
Signing certificate profile.

Only remove the unsigned Windows warning from the website after a signed
release is published and manually verified on Windows.

## Out of Scope

Linux provenance, checksum publishing, package repository signing, and Sigstore
attestations are separate work. This plan only covers Windows Authenticode
signing for Freed Desktop release artifacts.

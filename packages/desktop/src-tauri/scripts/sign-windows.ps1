param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Path
)

$ErrorActionPreference = "Stop"

# Tauri signCommand contract:
# - Tauri replaces `%1` in tauri.conf.json with the artifact path to sign.
# - The command must sign that exact file in place and exit non-zero on failure.
# - This scaffold is intentionally not wired into tauri.conf.json yet.

$requiredVariables = @(
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "WINDOWS_TRUSTED_SIGNING_ACCOUNT_NAME",
  "WINDOWS_TRUSTED_SIGNING_CERT_PROFILE",
  "WINDOWS_TRUSTED_SIGNING_ENDPOINT"
)

$missingVariables = @()
foreach ($name in $requiredVariables) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    $missingVariables += $name
  }
}

if ($missingVariables.Count -gt 0) {
  throw "Windows signing is not configured. Missing environment variable(s): $($missingVariables -join ', ')"
}

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
  throw "Windows signing target does not exist: $Path"
}

throw @"
Windows signing scaffold validated its inputs, but signing is not implemented yet.

Before wiring this script into tauri.conf.json, finish the Microsoft Artifact
Signing integration. The final implementation should sign this file in place:
$Path
"@

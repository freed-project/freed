# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include sensitive diagnostics in a public discussion.

Use one of these private channels:

1. Select **Report a vulnerability** on the repository's Security page.
2. In Freed, enable the private diagnostics you want to include, review the report, then select **Submit private report to GitHub**. Freed sends redacted text and selected stack traces. The diagnostic zip stays on your device.
3. If neither option works, email `support@freed.wtf` and ask for a secure follow-up channel. Do not attach secrets to the first email.

Include the affected version, impact, reproduction steps, and any mitigation you have already tried. Remove credentials, personal content, and unrelated local files. Freed applies automated redaction, but you should still review the report before sending it.

The security team will acknowledge the report, investigate it privately, and coordinate disclosure after a fix is available. Please do not publish details before that coordination is complete.

## Supported versions

Security fixes are shipped through the current Freed Desktop and PWA releases. Update to the newest available build before reporting an issue that may already be fixed.

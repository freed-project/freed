import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Desktop EULA",
  description:
    "End User License Agreement for Freed Desktop. Covers the device-local app license, high-risk features, and limitations.",
};

export default function EulaPage() {
  return (
    <LegalPage
      title="Desktop EULA"
      effectiveDate="March 31, 2026"
      intro={
        <>
          <p>
            This End User License Agreement governs your use of Freed Desktop. By installing or running
            Freed Desktop, you accept this license.
          </p>
        </>
      }
      sections={[
        {
          title: "1. License Grant",
          content: (
            <>
              <p>
                Subject to this agreement, you receive a personal, non-exclusive, revocable license to install
                and run Freed Desktop on devices you control.
              </p>
            </>
          ),
        },
        {
          title: "2. Local-First Software",
          content: (
            <>
              <p>
                Freed Desktop runs on your device. It stores data locally and may interact with cloud providers
                or third-party platforms only when you explicitly choose to connect them.
              </p>
            </>
          ),
        },
        {
          title: "3. High-Risk Features",
          content: (
            <>
              <p>
                Some desktop-only integrations, especially social capture and provider-specific login flows,
                are high-risk features. They can cause account restrictions, forced logouts, CAPTCHAs,
                password resets, or permanent bans by third-party providers.
              </p>
              <p>
                Freed does not claim these features are undetectable, compliant with every provider policy,
                or safe for every account. If losing access would materially hurt you, do not use them.
              </p>
              <p>
                Do not use high-risk features with employer, client, school, newsroom, government,
                activist, or regulated accounts unless you are prepared for potential fallout.
              </p>
            </>
          ),
        },
        {
          title: "4. Your Responsibility",
          content: (
            <>
              <p>
                You are solely responsible for deciding whether to use Freed Desktop with any account or service,
                for complying with any third-party terms that apply to you, and for backing up any data you care about.
              </p>
            </>
          ),
        },
        {
          title: "5. Restrictions",
          content: (
            <>
              <p>
                You may not use Freed Desktop for unlawful activity, unauthorized access, or any use that violates
                the rights of others. This license terminates automatically if you breach these terms.
              </p>
            </>
          ),
        },
        {
          title: "6. Disclaimer and Liability Limits",
          content: (
            <>
              <p>
                Freed Desktop is provided as-is, without warranties of any kind. To the maximum extent allowed by law,
                Freed contributors and operators are not liable for losses arising from installation, updates,
                provider enforcement, account damage, or data loss.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}

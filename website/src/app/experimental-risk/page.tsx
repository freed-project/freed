import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Experimental Risk Addendum",
  description:
    "Provider risk disclosures for Freed. Covers social capture, account bans, and why some features are intentionally risky.",
};

export default function ExperimentalRiskPage() {
  return (
    <LegalPage
      title="Experimental Risk Addendum"
      effectiveDate="March 31, 2026"
      intro={
        <>
          <p>
            This addendum exists to be painfully clear. Some Freed features are risky on purpose because
            the surrounding ecosystem is hostile to user control. If you enable those features, you are
            joining the experiment with eyes open.
          </p>
        </>
      }
      sections={[
        {
          title: "1. The Real Risks",
          content: (
            <>
              <p>
                Third-party services can detect or dislike automated or semi-automated behavior. Freed use may
                trigger CAPTCHAs, device challenges, forced re-authentication, password resets, temporary suspensions,
                shadow restrictions, or permanent bans.
              </p>
            </>
          ),
        },
        {
          title: "2. Who Should Not Use High-Risk Features",
          content: (
            <>
              <p>
                Do not use high-risk features with employer, client, newsroom, school, government, activist, or
                regulated accounts if losing access would materially hurt you or anyone else.
              </p>
            </>
          ),
        },
        {
          title: "3. No Safety Claims",
          content: (
            <>
              <p>
                We do not claim that Freed is undetectable, compliant with every provider policy, or safe for every
                account. If anyone tells you otherwise, they are selling incense to a house fire.
              </p>
            </>
          ),
        },
        {
          title: "4. Your Decision",
          content: (
            <>
              <p>
                You choose whether to enable risky features. If you proceed, you are accepting the possibility of
                breakage, account enforcement, and provider retaliation.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}

import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "Terms of Use for Freed, the website and PWA. Covers experimental use, account risk, and local-first software disclaimers.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      effectiveDate="March 31, 2026"
      intro={
        <>
          <p>
            These Terms of Use apply to the Freed website and PWA. Freed is experimental software.
            If you use it, you are agreeing to use it at your own risk and to stay responsible for
            the accounts, data, and platforms you choose to connect.
          </p>
        </>
      }
      sections={[
        {
          title: "1. What Freed Is",
          content: (
            <>
              <p>
                Freed is local-first software for reading, organizing, and in some cases capturing
                content that you already have access to. Freed is not a social network, not a managed
                syncing service, and not an agent acting on your behalf on our servers.
              </p>
              <p>
                The website provides downloads, documentation, and the PWA. The PWA runs in your browser
                or installed web app context on your device.
              </p>
            </>
          ),
        },
        {
          title: "2. Experimental Status",
          content: (
            <>
              <p>
                Freed is a live experiment. Features may break, disappear, or change behavior without notice.
                Compatibility with third-party services is not promised. Data loss, duplicated content,
                failed syncs, or broken provider integrations can happen.
              </p>
            </>
          ),
        },
        {
          title: "3. Experimental and Account Risk",
          content: (
            <>
              <p>
                Freed is built for user control in ecosystems that do not always welcome it.
                Some features are intentionally sharp-edged. If you use them, you are joining
                the experiment with your eyes open.
              </p>
              <p>
                If you use Freed with third-party services, you remain responsible for your relationship
                with those services. Their terms, rules, rate limits, fraud systems, and account enforcement
                policies still apply to you.
              </p>
              <p>
                Using Freed can trigger rate limits, forced logouts, password resets, temporary locks,
                or permanent account bans. Do not use Freed with any account if losing access to that account
                would create unacceptable personal, financial, or professional harm.
              </p>
              <p>
                Do not use high-risk features with employer, client, newsroom, school, government,
                activist, or regulated accounts unless you are fully prepared for the fallout.
              </p>
            </>
          ),
        },
        {
          title: "4. Acceptable Use",
          content: (
            <>
              <p>You may use Freed only with accounts, devices, and content you are authorized to access.</p>
              <p>
                You may not use Freed to bypass access controls, impersonate others, run unlawful data collection,
                or operate against employer, client, school, government, or regulated accounts unless you accept
                the full risk and responsibility for doing so.
              </p>
            </>
          ),
        },
        {
          title: "5. No Warranty",
          content: (
            <>
              <p>
                Freed is provided as-is and as-available. We make no warranty that it is safe, secure,
                accurate, uninterrupted, compatible with any provider, or fit for any particular purpose.
              </p>
            </>
          ),
        },
        {
          title: "6. Limitation of Liability",
          content: (
            <>
              <p>
                To the maximum extent allowed by law, Freed contributors and operators are not liable for
                indirect, incidental, special, consequential, exemplary, or punitive damages, or for loss of
                accounts, data, content access, profits, business opportunities, or reputation arising from
                your use of Freed.
              </p>
            </>
          ),
        },
        {
          title: "7. Changes",
          content: (
            <>
              <p>
                We may update these terms as the software evolves. When we do, we will update the effective date
                and require a fresh local acceptance where the product enforces clickwrap.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}

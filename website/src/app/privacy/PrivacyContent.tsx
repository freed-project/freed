"use client";

import Link from "next/link";
import { motion } from "framer-motion";

export default function PrivacyContent() {
  return (
    <section className="py-24 sm:py-32 px-4 sm:px-6 md:px-12 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <motion.article
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="prose prose-invert prose-base sm:prose-lg"
        >
          {/* Header */}
          <header className="text-center mb-10 sm:mb-16">
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold mb-4 sm:mb-6">
              <span className="gradient-text">Privacy Policy</span>
            </h1>
            <p className="text-text-secondary text-lg sm:text-xl">
              Effective March 31, 2026
            </p>
          </header>

          {/* The short version callout */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="glass-card p-6 sm:p-8 mb-12 border-l-4 border-glow-purple"
          >
            <h2 className="text-lg font-bold text-text-primary mb-3 mt-0">
              The short version
            </h2>
            <p className="text-text-secondary text-sm sm:text-base leading-relaxed mb-0">
              Freed collects nothing about you. Your social media data lives on
              your device. We have no database of users, no analytics pipeline,
              no ad network, no investors to appease with engagement metrics. If
              you skip the rest of this page, that sentence is all you need.
            </p>
          </motion.div>

          {/* Content */}
          <div className="space-y-10 text-text-secondary">
            {/* 1. This Website */}
            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                This Website (freed.wtf)
              </h2>
              <p>
                This marketing site is a static Next.js application hosted on
                Vercel. Like any web host, Vercel's infrastructure logs standard
                HTTP request metadata (your IP address, browser user-agent,
                timestamp, and the URL requested) as part of their CDN
                operation. This data is governed by{" "}
                <a
                  href="https://vercel.com/legal/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-primary underline hover:no-underline transition-colors"
                >
                  Vercel's Privacy Policy
                </a>
                .
              </p>
              <p>
                We do not run any analytics software, advertising pixels,
                tracking scripts, or session recorders on this site. There is no
                cookie consent banner because there are no cookies to consent
                to. If you subscribe to release notifications, your email
                address is stored via our newsletter provider solely for that
                purpose and nothing else.
              </p>
              <p>
                If you accept the download clickwrap, the website stores a small
                local record in your browser showing which legal bundle version
                you accepted and when. That record stays in your browser. We do
                not receive it.
              </p>
            </section>

            {/* 2. The App */}
            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                The Freed Application
              </h2>
              <p>
                Freed is{" "}
                <strong className="text-text-primary">local-first</strong>{" "}
                software. When you use it:
              </p>
              <ul className="space-y-4 mt-4">
                <li>
                  <strong className="text-text-primary block mb-1">
                    Your feed data stays on your device.
                  </strong>
                  Posts captured from X, RSS, YouTube, or any other source are
                  written to local storage: IndexedDB in the browser, the
                  filesystem in the desktop app. None of this ever touches our
                  infrastructure, because we have no infrastructure to touch.
                </li>
                <li>
                  <strong className="text-text-primary block mb-1">
                    Zero telemetry.
                  </strong>
                  There are no analytics calls, no crash reporters phoning home,
                  no feature flags fetched from a remote server, no usage
                  statistics transmitted anywhere. The app runs entirely
                  air-gapped from any backend we operate.
                </li>
                <li>
                  <strong className="text-text-primary block mb-1">
                    No account required.
                  </strong>
                  Freed does not have a sign-up flow, a user database, or a
                  concept of "your profile" on our servers. There is no profile
                  on our servers. There are no servers.
                </li>
                <li>
                  <strong className="text-text-primary block mb-1">
                    Your credentials never leave your device.
                  </strong>
                  Freed accesses social platforms through your own authenticated
                  browser sessions. Credentials are stored in your local
                  keychain or browser storage and never transmitted to us.
                </li>
              </ul>
            </section>

            {/* 3. Sync */}
            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                Data Sync: Your Cloud, Your Keys
              </h2>
              <p>
                If you enable cross-device sync, your Freed data is backed up
                to cloud storage <em>you already own</em>: Google Drive,
                iCloud, or Dropbox. The data is encrypted with a passphrase
                only you know before it ever leaves your device. We cannot read
                it. We cannot be compelled to hand it over, because we do not
                have it.
              </p>
              <p>
                The local sync relay (desktop-to-phone) operates on your local
                network. It does not route through any server we operate.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                Legal Consent Records
              </h2>
              <p>
                Freed stores clickwrap acceptance locally on each device or
                browser where you accept it. The record contains a legal bundle
                version, a timestamp, and the consent surface that was accepted.
              </p>
              <p>
                Desktop provider warnings for X, Facebook, Instagram, and
                LinkedIn are also stored locally on that device. These records
                are not synced through Automerge and are not transmitted to us.
              </p>
            </section>

            {/* 4. Open Source */}
            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                Open Source Transparency
              </h2>
              <p>
                Every claim in this policy is verifiable by reading the code.
                Freed is MIT licensed and{" "}
                <a
                  href="https://github.com/freed-project/freed"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-primary underline hover:no-underline transition-colors"
                >
                  fully open source
                </a>
                . There is no proprietary backend, no closed-source analytics
                module, no obfuscated telemetry lurking in a build artifact. If
                you see something in the code that contradicts this policy, open
                an issue. We will fix it.
              </p>
            </section>

            {/* 5. Third-Party Services */}
            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                Third-Party Services
              </h2>
              <p>
                Freed captures content from third-party platforms (X, YouTube,
                RSS feeds, etc.) on your behalf, using your own authenticated
                session. By doing so, you remain subject to those platforms'
                terms of service and privacy policies. Freed does not aggregate
                or transmit that content anywhere. It stays local. The
                act of accessing it is governed by each platform's relationship
                with you, not with us.
              </p>
              <p>
                If you use a third-party AI provider, cloud storage provider,
                or platform login flow, their privacy policies and terms govern
                that interaction. Freed does not claim otherwise, and it does
                not act as a proxy that hides those relationships.
              </p>
            </section>

            {/* 6. Children */}
            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                Children's Privacy
              </h2>
              <p>
                Freed is not directed at children under 13. We do not knowingly
                collect any personal information from children. Given our
                local-first architecture, we are not positioned to collect
                anyone's personal information, but we state this explicitly for
                compliance clarity.
              </p>
            </section>

            {/* 7. Changes */}
            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                Changes to This Policy
              </h2>
              <p>
                If we ever change anything material here (which would require
                us to build infrastructure we currently don't have), we'll
                update the effective date at the top and post a note in the{" "}
                <Link
                  href="/updates"
                  className="text-text-primary underline hover:no-underline transition-colors"
                >
                  Updates
                </Link>{" "}
                section. The full history of changes is visible in the{" "}
                <a
                  href="https://github.com/freed-project/freed"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-primary underline hover:no-underline transition-colors"
                >
                  public git repository
                </a>
                .
              </p>
            </section>

            {/* 8. Contact */}
            <section className="pt-8 border-t border-freed-border">
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                Contact
              </h2>
              <p>
                Questions about privacy? Open an issue on{" "}
                <a
                  href="https://github.com/freed-project/freed"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-primary underline hover:no-underline transition-colors"
                >
                  GitHub
                </a>
                . We'd rather have a public conversation about our privacy
                posture than a private one; transparency is kind of the whole
                point.
              </p>
            </section>

            {/* Closing quote */}
            <section className="pt-4">
              <blockquote className="text-xl italic text-text-primary border-l-4 border-glow-purple pl-6">
                "Your data belongs to you."
                <footer className="text-text-secondary text-base mt-2 not-italic">
                  - The Freed Manifesto
                </footer>
              </blockquote>
            </section>
          </div>
        </motion.article>
      </div>
    </section>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import styles from "./vision.module.css";

export const metadata: Metadata = {
  title: "The Freed Vision",
  description:
    "How Freed can protect the minds of the next generation and help culture reclaim control of attention.",
  alternates: { canonical: "/vision" },
  openGraph: {
    title: "The Freed Vision",
    description:
      "Give the next generation authority over the information that shapes its minds.",
    url: "https://freed.wtf/vision",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Freed Vision",
    description:
      "Give the next generation authority over the information that shapes its minds.",
  },
};

const integer = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const supportPaths = [
  {
    stage: "Angels",
    title: "Fund the proof that Freed can endure",
    body: "Freed has working software, but no public traction yet. Patient angel capital can fund a stable launch, more engineering, security review, specialist counsel, provider adaptation, and distribution before recurring support can carry the company on its own.",
    effect:
      "The right investor accepts the open-source core, the privacy boundary, provider hostility, and a mission I will not sell to an advertising model. The next proof is usage, retention, referrals, and recurring support.",
  },
  {
    stage: "Users",
    title: "Prove that people want their minds back",
    body: "Use Freed with real sources. Tell me where it fails. Come back if it changes how you read. Invite people who feel the same pressure. If Freed earns a place in your life, support the work from inside Freed Desktop. Every dollar you send does double duty. It pays for the work now, and it hands me the evidence that brings angels in behind you.",
    effect:
      "Your usage shows demand, your renewals show value, and your referrals create reach. Together they give a patient investor evidence to act, so your ten dollars can move far more than ten dollars.",
  },
] as const;

function Arrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

export default function VisionPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="vision-title">
        <div className={styles.frame}>
          <div className={styles.heroGrid}>
            <div>
              <h1 id="vision-title">
                Future humans deserve <span>healthy social commons.</span>
              </h1>
            </div>
            <div className={styles.heroCopy}>
              <p>
                Big tech profits when you are destabilized and addicted.
              </p>
              <p>
                Freed curates the feed with your algos, not theirs. We&rsquo;re
                restoring digital sovereignty at scale.
              </p>
            </div>
          </div>

          <aside className={styles.status} aria-label="Current status">
            <div>
              <strong>Working software</strong>
              <span>
                Open source.{" "}
                <Link href="/changelog">Active development</Link>.
              </span>
            </div>
            <div>
              <strong>Pre-launch</strong>
              <span>No public user, retention, or revenue claims</span>
            </div>
          </aside>
        </div>
      </section>

      <section className={styles.proposition} aria-labelledby="mechanism-title">
        <div className={styles.frame}>
          <p className={styles.eyebrow}>The cultural mechanism</p>
          <div className={styles.propositionGrid}>
            <h2 id="mechanism-title">Change the environment that shapes a mind.</h2>
            <div className={styles.propositionCopy}>
              <p>
                Freed Desktop brings content from chosen sources into a private
                library on the reader's computer. The reader controls ranking,
                syncs the library between their own devices, and reaches an
                actual end.
              </p>
              <p>
                Those product choices teach a different habit: decide what
                matters before an engagement system decides for you.
              </p>
            </div>
          </div>

          <div className={styles.caseGrid}>
            <article>
              <p className={styles.cardLabel}>Inside one mind</p>
              <h3>Attention becomes governable.</h3>
              <ul>
                <li>Chosen sources replace compulsive destinations</li>
                <li>Declared goals replace engagement optimization</li>
                <li>A finite queue restores a stopping point</li>
                <li>Feed data and reading history remain private</li>
              </ul>
            </article>
            <article className={styles.riskCard}>
              <p className={styles.cardLabel}>Across a culture</p>
              <h3>Human judgment regains authority.</h3>
              <ul>
                <li>People can share ranking rules instead of surrendering to one</li>
                <li>Communities can cultivate attention without owning private data</li>
                <li>Writers can reach readers without optimizing for outrage</li>
                <li>Software can compete to save time instead of consuming it</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className={styles.capital} id="support" aria-labelledby="support-title">
        <div className={styles.frame}>
          <p className={styles.eyebrow}>Material support</p>
          <div className={styles.sectionHeading}>
            <h2 id="support-title">Two groups can make Freed endure.</h2>
            <p>
              I need angels who can fund real engineering now, and I need users
              whose support proves the thesis those angels are betting on. Every
              dollar a user sends makes that bet more rational, which is why the
              two groups are one system rather than two asks.
            </p>
          </div>

          <div className={styles.pathList}>
            {supportPaths.map((path) => (
              <article key={path.stage}>
                <div className={styles.pathStage}>{path.stage}</div>
                <div className={styles.pathBody}>
                  <h3>{path.title}</h3>
                  <p>{path.body}</p>
                </div>
                <aside>
                  <strong>Material effect</strong>
                  <p>{path.effect}</p>
                </aside>
              </article>
            ))}
          </div>

          <div className={styles.supportLoop}>
            <p className={styles.cardLabel}>How support compounds</p>
            <ol>
              <li>
                <strong>Monthly support</strong>
                <span>Funds each month of work.</span>
              </li>
              <li>
                <strong>Evidence</strong>
                <span>
                  Shows that Freed keeps earning a place in people&rsquo;s lives.
                </span>
              </li>
              <li>
                <strong>Angel confidence</strong>
                <span>Makes a larger check easier to justify.</span>
              </li>
              <li>
                <strong>More capacity</strong>
                <span>Buys engineering, security, counsel, and reach.</span>
              </li>
            </ol>
          </div>

          <aside className={styles.modelNote}>
            <strong>Every contribution works twice.</strong>
            <p>
              Every dollar you send funds the work and becomes a vote of
              confidence when I sit down with angels. Monthly support carries
              more weight because you renew that vote. It shows Freed keeps
              earning its place in your life, gives me dependable runway, and
              makes an angel check easier to justify. Angel capital can then buy
              engineering capacity, specialist work, and speed I cannot reach
              alone.
            </p>
            <p>
              If Freed reaches {integer.format(10_000)} active users and
              {" "}{percent.format(0.1)} choose to contribute {dollars.format(10)}
              {" "}per month, that is {dollars.format(120_000)} in gross annual
              support. That can eventually make Freed permanently independent.
              Before then, that evidence can attract the patient capital I need
              to get there.
            </p>
          </aside>
        </div>
      </section>

      <section className={styles.governance} aria-labelledby="capital-title">
        <div className={styles.frame}>
          <p className={styles.eyebrow}>What capital must protect</p>
          <div className={styles.governanceGrid}>
            <h2 id="capital-title">Freed's financing must preserve its reason to exist.</h2>
            <div>
              <p>
                The core remains MIT licensed. Private feed data, relationships,
                reading history, and attention are never the product. Capital
                receives no control over an individual's ranking. Investors back
                trust, distribution, adaptation, and execution.
              </p>
              <p>
                Some platforms may fight Freed. They can change technical
                controls, suspend accounts, and bring legal claims. The company
                must budget for that conflict, build beyond any one provider,
                and avoid promises of uninterrupted access.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.invitation} aria-labelledby="invitation-title">
        <div className={styles.frame}>
          <p className={styles.eyebrow}>The next step</p>
          <div className={styles.invitationGrid}>
            <div>
              <h2 id="invitation-title">Give the next generation a mind of its own.</h2>
              <p>
                Use Freed when the first cohort opens. Help test it, share it,
                and sustain it if it earns your trust. If you invest in
                open-source consumer software and understand adversarial
                platforms, talk with Aubrey about the company Freed could become.
              </p>
            </div>
            <div className={styles.invitationActions}>
              <Link className={`${styles.primaryAction} btn-primary`} href="/get">
                Get Freed <Arrow />
              </Link>
              <a
                className={`${styles.secondaryAction} btn-secondary`}
                href="https://aubreyfalconer.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Talk with Aubrey
              </a>
              <a
                className={`${styles.secondaryAction} btn-secondary`}
                href="https://github.com/freed-project/freed"
                target="_blank"
                rel="noopener noreferrer"
              >
                Review the code
              </a>
            </div>
          </div>

          <p className={styles.disclaimer}>
            This page describes a product and company thesis. It is not an offer
            to sell securities, a solicitation to buy them, or a promise of
            returns.
          </p>
        </div>
      </section>
    </div>
  );
}

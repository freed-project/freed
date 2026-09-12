"use client";

import { FaGithub, FaRegEnvelope } from "react-icons/fa6";
import { useNewsletter } from "@/context/NewsletterContext";
import VisionMilestones from "./VisionMilestones";
import HeroArtwork from "./HeroArtwork";
import styles from "./variants.module.css";

export default function VisionVariants() {
  const { openModal } = useNewsletter();
  return (
    <>
      <div className={styles.page} data-vision-variant="backer-focused">
        <section className={styles.hero} aria-labelledby="vision-title">
          <div>
            <h1 id="vision-title">
              Your feed. Your rules.{" "}
              <span className={styles.headlineAccent}>Your life.</span>
            </h1>
            <p className={styles.intro}>
              Follow the people and ideas you care about. Decide for yourself what
              deserves your attention.
            </p>
          </div>
          <HeroArtwork />
        </section>
        <section className={styles.mission} id="mission-review" aria-labelledby="mission-title">
          <h2 id="mission-title">A healthier commons for the next generation.</h2>
          <p>The places where we share ideas shape the world we inherit. Freed starts with a feed you control. Our ambition is a social commons where people can think freely and learn from one another.</p>
        </section>
        <section className={styles.principles} aria-label="Freed’s commitments">
          <article>
            <h3>Control your feed.</h3>
            <p>Your sources and ranking, under your control.</p>
          </article>
          <article>
            <h3>Keep your library private.</h3>
            <p>Your private library lives on your computer.</p>
          </article>
          <article>
            <h3>Follow across platforms.</h3>
            <p>Follow people and ideas across platforms in one feed.</p>
          </article>
        </section>
        <VisionMilestones />
        <section className={styles.openSource} aria-labelledby="open-source-title">
          <h2 id="open-source-title">Look under the hood.</h2>
          <div>
            <p className={styles.openSourceIntro}>Evaluate the work for yourself. Freed’s public, MIT-licensed code makes our choices about privacy and your feed open to scrutiny.</p>
            <p className={styles.openPromise}>
              Your private data and attention are never the product. Investors
              receive no control over your ranking.
            </p>
            <div className={styles.communityActions}>
              <a className="btn-secondary" href="https://github.com/freed-project/freed"
                target="_blank" rel="noopener noreferrer"><FaGithub aria-hidden="true" />Explore the code</a>
            </div>
          </div>
        </section>
        <section className={styles.support} id="support" aria-labelledby="support-title">
          <h2 id="support-title">Follow our progress.</h2>
          <div>
            <p>Considering supporting Freed? Subscribe for new builds and major progress as the work develops.</p>
            <div className={styles.communityActions}>
              <button type="button" className="btn-secondary"
                onClick={() => openModal({ detailsOpen: true })}>
                <FaRegEnvelope aria-hidden="true" />Subscribe to the newsletter
              </button>
            </div>
          </div>
        </section>
        <section className={styles.invitation} id="copy-review" aria-labelledby="invitation-title">
          <div>
            <h2 id="invitation-title">Help more people take back their attention.</h2>
            <p>Freed is working software with more to build. We’re looking for backers to fund development and partners to bring Freed to new audiences.</p>
          </div>
          <div className={styles.invitationActions}>
            <a className="btn-primary" href="https://aubreyfalconer.com"
              target="_blank" rel="noopener noreferrer">Connect with Aubrey
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4 10h11M11 6l4 4-4 4" />
              </svg>
            </a>
          </div>
        </section>
      </div>
    </>
  );
}

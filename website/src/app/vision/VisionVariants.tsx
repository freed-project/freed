"use client";

import { FaRegStar, FaRegEnvelope } from "react-icons/fa6";
import { useNewsletter } from "@/context/NewsletterContext";
import VisionMilestones from "./VisionMilestones";
import HeroArtwork from "./HeroArtwork";
import styles from "./variants.module.css";

function CommunityActions() {
  const { openModal } = useNewsletter();
  return (
    <div className={styles.communityActions}>
      <a
        className="btn-primary"
        href="https://github.com/freed-project/freed"
        target="_blank"
        rel="noopener noreferrer"
      >
        <FaRegStar aria-hidden="true" />
        Star on GitHub
      </a>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => openModal({ detailsOpen: true })}
      >
        <FaRegEnvelope aria-hidden="true" />
        Subscribe to the newsletter
      </button>
    </div>
  );
}

export default function VisionVariants() {
  return (
    <>
      <div className={styles.page} data-vision-variant="everyday">
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
            <CommunityActions />
          </div>
          <HeroArtwork />
        </section>
        <section className={styles.mission} aria-labelledby="mission-title">
          <h2 id="mission-title">
            Future humans deserve healthy social commons.
          </h2>
          <p>
            We’re building open-source software that gives people authority over
            the information shaping their minds. A feed you control is a start.
            A culture that protects that freedom is the ambition.
          </p>
        </section>
        <section className={styles.principles} aria-label="Freed’s commitments">
          <article>
            <h3>You choose.</h3>
            <p>Your sources and ranking, under your control.</p>
          </article>
          <article>
            <h3>You keep it.</h3>
            <p>Your private library lives on your computer.</p>
          </article>
          <article>
            <h3>Bring it together.</h3>
            <p>Follow people and ideas across platforms in one feed.</p>
          </article>
        </section>
        <VisionMilestones />
        <section
          className={styles.openSource}
          aria-labelledby="open-source-title"
        >
          <div className={styles.openSourceHeading}>
            <h2 id="open-source-title">Open source.</h2>
            <p>Trust should be earned.</p>
          </div>
          <div>
            <p className={styles.openSourceIntro}>
              Freed’s code is public and MIT licensed. Our choices about privacy
              and how your feed works are open to scrutiny.
            </p>
            <p className={styles.openPromise}>
              Your private data and attention are never the product. Investors
              receive no control over your ranking.
            </p>
          </div>
        </section>
        <section
          className={styles.support}
          id="support"
          aria-labelledby="support-title"
        >
          <div>
            <h2 id="support-title">Help this grow.</h2>
            <p>
              Follow the progress, show your support, or help fund the work
              ahead.
            </p>
          </div>
          <div className={styles.supportPaths}>
            <article>
              <h3>Stay in the loop.</h3>
              <p>
                Subscribe for new builds and major progress. Star Freed on
                GitHub to show your support.
              </p>
              <CommunityActions />
            </article>
            <article>
              <h3>Help make it happen.</h3>
              <p>
                If you can fund development, sponsor work, or help Freed reach
                more people, talk with Aubrey.
              </p>
              <div className={styles.communityActions}>
                <a
                  className="btn-primary"
                  href="https://aubreyfalconer.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Talk with Aubrey
                </a>
              </div>
            </article>
          </div>
        </section>
        <section
          className={styles.invitation}
          aria-labelledby="invitation-title"
        >
          <div>
            <h2 id="invitation-title">
              Give the next generation a mind of its own.
            </h2>
            <p>
              Subscribe to follow the work. Star Freed to show your support.
              Talk with Aubrey if you can help bring this vision to more people.
            </p>
          </div>
          <div className={styles.invitationActions}>
            <CommunityActions />
            <a
              className="btn-primary"
              href="https://aubreyfalconer.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Talk with Aubrey
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

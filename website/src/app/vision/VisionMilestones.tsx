"use client";

import { useRef, type KeyboardEvent } from "react";
import { PlanProofLink } from "@/components/PlanProofLink";
import {
  FaRss,
  FaCodeBranch,
  FaDesktop,
  FaRegUser,
  FaRegBookmark,
  FaPenNib,
} from "react-icons/fa6";
import source from "./roadmap-source.json";
import styles from "./milestones.module.css";

// Selected phases from the validated production manifest. Status is read from
// the snapshot, never inferred from these concise presentation descriptions.
// The combined feed card follows phase 7: broader social capture remains in progress.
const milestones = [
  {
    phase: 1,
    title: "Build the foundation",
    description:
      "An open-source core, a public home for Freed, and the shared library behind the apps.",
    icon: FaCodeBranch,
  },
  {
    phase: 7,
    title: "Bring your feeds together",
    description:
      "Facebook, Instagram, X, RSS, and more in one library. Capture reliability remains active work.",
    icon: FaRss,
  },
  {
    phase: 5,
    title: "Make it your daily feed",
    description:
      "Freed Desktop is available. Reliability and recovery remain active work.",
    icon: FaDesktop,
  },
  {
    phase: 8,
    title: "Bring your people together",
    description:
      "Friends connects people and their accounts. Contact integrations are still in progress.",
    icon: FaRegUser,
  },
  {
    phase: 9,
    title: "Take control in your browser",
    description:
      "Planned extensions for quick saves and more control over social feeds.",
    icon: FaRegBookmark,
  },
  {
    phase: 13,
    title: "Publish on your own terms",
    description:
      "Publish once on your own site, then share with people across platforms.",
    icon: FaPenNib,
  },
] as const;
const statusLabels: Record<string, string> = {
  complete: "Complete",
  current: "In progress",
  upcoming: "Upcoming",
};
const ordinal = new Intl.NumberFormat("en-US", { minimumIntegerDigits: 2 });

export default function VisionMilestones() {
  const rail = useRef<HTMLDivElement>(null);
  function move(direction: number) {
    const element = rail.current;
    if (!element) return;
    const card = element.querySelector("article");
    const distance = (card?.getBoundingClientRect().width ?? 280) + 20;
    element.scrollBy({
      left: direction * distance,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      move(event.key === "ArrowRight" ? 1 : -1);
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      rail.current?.scrollTo({
        left: event.key === "Home" ? 0 : rail.current.scrollWidth,
        behavior: "instant",
      });
    }
  }
  return (
    <section
      className={styles.section}
      aria-labelledby="milestones-title"
      id="milestones"
    >
      <div className={styles.heading}>
        <div>
          <h2 id="milestones-title">Current status: working software.</h2>
          <p>
            Read your sources in Freed today. Follow what we’re building next.
          </p>
        </div>
        <PlanProofLink
          destination="plan"
          label="See the full roadmap"
          className={styles.roadmapLink}
        />
      </div>
      <div
        ref={rail}
        className={styles.rail}
        tabIndex={0}
        role="region"
        aria-label="Milestones. Use left and right arrow keys to explore."
        onKeyDown={onKeyDown}
      >
        <ol className={styles.list}>
          {milestones.map(
            ({ phase, title, description, icon: Icon }, index) => {
              const status = source.manifest.phases.find(
                (entry) => entry.id === phase,
              )?.status;
              if (!status || !statusLabels[status])
                throw new Error(
                  `Missing validated milestone status for phase ${phase}`,
                );
              return (
                <li key={title}>
                  <article data-status={status} className={styles.card}>
                    <div className={styles.illustration} aria-hidden="true">
                      <div className={styles.iconFrame}>
                        <Icon />
                      </div>
                      <span>{ordinal.format(index + 1)}</span>
                    </div>
                    <div className={styles.status}>
                      <i aria-hidden="true" />
                      {statusLabels[status]}
                    </div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </article>
                </li>
              );
            },
          )}
        </ol>
      </div>
    </section>
  );
}

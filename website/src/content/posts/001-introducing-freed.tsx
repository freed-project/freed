import { definePost } from "../types";

export default definePost(
  {
    slug: "introducing-freed",
    title: "Introducing Freed: Take Back Your Feed",
    description:
      "Our first newsletter. Why we built Freed, what we believe, and where we're headed.",
    date: "2026-02-01",
    author: "The Freed Team",
    tags: ["announcement", "philosophy"],
  },
  <>
    <p>
      Welcome to the first Freed newsletter. If you're reading this, you've
      either subscribed to our email list or discovered us through RSS—which, by
      the way, is exactly the kind of choice we think you should have.
    </p>

    <h2>Why We Built This</h2>
    <p>
      Modern social media platforms have weaponized psychology against us. Their
      algorithms don't serve our interests—they serve engagement metrics.
      They've discovered that outrage, anxiety, and FOMO are more addictive than
      connection and joy.
    </p>
    <p>
      We're not the first to notice this. But we are building something about
      it.
    </p>

    <h2>What Freed Actually Is</h2>
    <p>
      Freed captures your social feeds locally—X, RSS, YouTube, newsletters,
      podcasts—and creates a unified timeline that <em>you</em> control. No
      engagement optimization. No algorithmic manipulation. Just content from
      people you actually care about, weighted by criteria you define.
    </p>
    <p>
      All data stays on your device. We have no servers. We literally cannot see
      what you capture. That's the point.
    </p>

    <h2>The Roadmap</h2>
    <p>
      We've published our full <a href="/roadmap">roadmap</a> publicly. Here's
      where we are:
    </p>
    <ul>
      <li>
        <strong>Phase 1-2: ✓ Complete</strong> — Foundation and capture skills
        for X and RSS
      </li>
      <li>
        <strong>Phase 3-5: In Progress</strong> — Save for Later, Sync Layer,
        and the Desktop App
      </li>
      <li>
        <strong>Phase 6+: Coming</strong> — PWA, Facebook/Instagram capture,
        Friend Map, and more
      </li>
    </ul>
    <p>
      The desktop app is our highest priority. It's the hub that makes
      everything else possible.
    </p>

    <h2>How You Can Help</h2>
    <p>Freed is open source and MIT licensed. We need help with:</p>
    <ul>
      <li>Desktop app UI (Tauri + React)</li>
      <li>Additional capture layers</li>
      <li>Sync layer implementation</li>
      <li>Testing, testing, testing</li>
    </ul>
    <p>
      Check out the repo at{" "}
      <a
        href="https://github.com/freed-project/freed"
        target="_blank"
        rel="noopener noreferrer"
      >
        github.com/freed-project/freed
      </a>
      .
    </p>

    <h2>Stay Connected</h2>
    <p>
      This newsletter will be your primary source for Freed updates. We'll share
      progress, technical deep-dives, and occasional philosophical rants about
      the attention economy.
    </p>
    <p>
      Every edition will be published here on our website—permanent, shareable,
      and available via RSS. Because we practice what we preach.
    </p>

    <blockquote>
      "The algorithm that serves you best is the one you wrote yourself."
    </blockquote>

    <p>
      Until next time,
      <br />
      The Freed Team
    </p>
  </>
);

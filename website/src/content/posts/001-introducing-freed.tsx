import { definePost } from "../types";

export default definePost(
  {
    slug: "introducing-freed",
    title: "Introducing Freed: Take Back Your Feed",
    description:
      "Why we built a local-first, open-source feed reader that puts you back in control of your information diet.",
    date: "2026-02-17",
    author: "Aubrey Falconer",
    authorUrl: "https://AubreyFalconer.com",
    tags: ["announcement", "philosophy", "technical"],
  },
  <>
    <p>
      Welcome to the first Freed update. You're here because you subscribed or
      found us through RSS. Both are good choices.
    </p>

    <h2>The Problem</h2>
    <p>
      Open your feed. Something else has already decided what's waiting. Not to
      serve you. To keep you in the system. Platforms replaced chronological
      reading with engagement algorithms optimized for clicks, shares, and
      time-on-screen. That's what they sell. The machine is working perfectly.
      It's just not working for you.
    </p>

    <h2>What Freed Does</h2>
    <p>
      Freed runs in the background, capturing posts from the sources you care
      about: X, RSS feeds, YouTube channels, newsletters, and podcasts.
      Everything lands in a local vault on your computer, live-synced to your
      phone. No central servers. We never see your data.
    </p>
    <ul>
      <li>
        <strong>Your algorithm, your rules.</strong> Posts are ranked by
        criteria you set: author trust, topic relevance, freshness. You can
        tune the weights and read exactly why any post appears first.
      </li>
      <li>
        <strong>You can be done.</strong> When you've read everything from your
        subscribed sources, you're caught up. There's an actual end.
      </li>
      <li>
        <strong>Ulysses Mode.</strong> Lock yourself out of X or Instagram's
        algorithmic feed and only access them through Freed. You get the
        content without the compulsion.
      </li>
      <li>
        <strong>Open source.</strong> MIT licensed. Fork it, audit it, build
        on it.
      </li>
    </ul>

    <h2>Where We Are</h2>
    <p>
      X and RSS capture are working. Save for Later works. The desktop app and
      mobile reader are in active development. We're building in public and
      shipping fast.
    </p>

    <h2>How You Can Help</h2>
    <ul>
      <li>
        <strong>
          <a href="https://github.com/freed-project/freed">Star the repo.</a>
        </strong>{" "}
        It signals that this matters and helps others find us.
      </li>
      <li>
        <strong>Try the PWA.</strong> Add some RSS feeds at{" "}
        <a href="https://app.freed.wtf">app.freed.wtf</a> and tell us what's
        broken.
      </li>
      <li>
        <strong>Contribute.</strong> Especially if you know Rust or have ideas
        for additional capture sources. Check the issues list.
      </li>
      <li>
        <strong>Share this.</strong> Send it to someone who's complained about
        social media lately.
      </li>
    </ul>

    <h2>What's Next</h2>
    <p>
      Desktop-to-phone sync. A downloadable desktop app for macOS, Windows, and
      Linux. Facebook and Instagram capture. Cloud sync via Google Drive,
      iCloud, or Dropbox. We'll update you when each one ships. We don't spam.
    </p>

    <p>
      Until next time,
      <br />
      <a href="https://AubreyFalconer.com">Aubrey Falconer</a>
    </p>
  </>
);

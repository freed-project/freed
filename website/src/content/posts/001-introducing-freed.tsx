import { definePost } from "../types";

export default definePost(
  {
    slug: "introducing-freed",
    title: "Introducing Freed: Take Back Your Feed",
    description:
      "Why we built a local-first, open-source feed reader that puts you back in control of your information diet.",
    date: "2026-02-17",
    author: "The Freed Team",
    tags: ["announcement", "philosophy", "technical"],
  },
  <>
    <p>
      Welcome to the first Freed newsletter. You're here because you subscribed
      or found us through RSS. Both are good choices.
    </p>

    <h2>The Feed Isn't For You</h2>
    <p>
      Somewhere in the last decade, reading the internet became something that
      happened to you. Platforms killed chronological feeds and replaced them
      with algorithms optimized for one thing: engagement. Not your
      satisfaction. Not your learning. Engagement: clicks, shares,
      time-on-screen. That's what they sell.
    </p>
    <p>
      Outrage gets amplified because it's engaging. Nuance gets buried because
      it's slow. Infinite scroll removes the stopping point. None of this is
      accidental.
    </p>

    <h2>What Freed Does</h2>
    <p>
      Freed captures content from the sources you choose (X, RSS feeds, YouTube
      channels, newsletters, podcasts) and shows it to you chronologically, on
      your device, ranked the way you decide. You control the weights. You write
      the algorithm.
    </p>
    <ul>
      <li>
        <strong>No central servers.</strong> Your content lives on your device,
        synced between your own devices via Google Drive, iCloud, or Dropbox. We
        never see it.
      </li>
      <li>
        <strong>No engagement optimization.</strong> Posts are ranked by criteria
        you define: author trust, topic relevance, freshness. Not by what made
        someone else angry yesterday.
      </li>
      <li>
        <strong>You can be done.</strong> When you've seen everything from your
        subscribed sources, you've caught up. There's an actual end.
      </li>
      <li>
        <strong>Ulysses Mode.</strong> Configure Freed as your only lens for X
        or Instagram. You get the content without the algorithm. Named after the
        hero who had himself lashed to the mast so he could hear the Sirens
        without jumping overboard.
      </li>
      <li>
        <strong>Open source.</strong> MIT licensed. Read it, fork it, audit it.
      </li>
    </ul>

    <h2>Where We Are</h2>
    <p>
      Capturing from X and RSS works. Save for Later works. The desktop app and
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
      Sync between desktop and phone. A polished, downloadable desktop app.
      Windows and Linux builds. Cloud sync. Facebook and Instagram capture.
      We'll send an update when each of these lands. We don't spam.
    </p>

    <p>
      Until next time,
      <br />
      The Freed Team
    </p>
  </>
);

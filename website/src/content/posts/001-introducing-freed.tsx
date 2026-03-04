import { definePost } from "../types";

export default definePost(
  {
    slug: "introducing-freed",
    title: "Introducing Freed",
    description: "Your feeds, your way, on all your devices.",
    date: "2026-02-17",
    author: "Aubrey Falconer",
    authorUrl: "https://AubreyFalconer.com",
    tags: ["announcement", "philosophy", "technical"],
  },
  <>
    <p>
      The chronological feed was quietly killed by every major social platform.
      Did it fail? Only to exploit you.
    </p>
    <p>
      What replaced it? Psychological warfare to keep you addicted. Outrage gets
      amplified because it's engaging. Infinite scroll removes the natural rest
      point. Variable reward schedules, the same mechanism that makes slot
      machines addictive, keep you pulling down to refresh. None of this is
      accidental. Billions of dollars in engineering talent were deployed
      specifically to exploit the gaps in human cognition.
    </p>
    <p>I built Freed because we can do better.</p>

    <h2>What Freed Is</h2>
    <p>
      Freed is a local-first feed reader. It captures content from the sources
      you choose: social platforms, RSS feeds, YouTube channels, newsletters,
      and podcasts. Everything lands in a vault on your device, live-synced to
      your phone. You get a unified, chronological feed of everything you care
      about, ranked the way you decide. Your algorithm, your rules. The
      platforms become players in your game.
    </p>
    <ul>
      <li>
        <strong>No central servers.</strong> Your content lives on your device,
        synced between your own devices via Google Drive, iCloud, or Dropbox. I
        never see it.
      </li>
      <li>
        <strong>No engagement optimization.</strong> Posts are ranked by
        criteria you set: author trust, topic relevance, freshness. Not by what
        made someone else angry yesterday.
      </li>
      <li>
        <strong>You can be done.</strong> Freed tracks what you've read. When
        you've seen everything from your subscribed sources, you're caught up.
        There's an actual end.
      </li>
      <li>
        <strong>Ulysses Mode.</strong> Configure Freed as the only way you
        access social platforms. You get the content without the compulsion.
        Named after the hero who lashed himself to the mast so he could hear the
        Sirens without losing his mind.
      </li>
      <li>
        <strong>Open source.</strong> MIT licensed. Read it, fork it, audit it.
      </li>
    </ul>

    <h2>How It's Built</h2>
    <p>
      Freed runs as a desktop app (macOS, Windows, Linux) that captures content
      in the background using your existing browser sessions. A companion PWA at{" "}
      <a href="https://app.freed.wtf">app.freed.wtf</a> syncs with the desktop
      when you're on the same network and falls back to your cloud storage when
      you're not. The architecture is deliberately local-first: if Freed shuts
      down tomorrow, your data and your app keep working.
    </p>

    <h2>Where Things Stand</h2>
    <p>
      RSS capture is working. X and Save for Later are coming soon. The desktop
      app and mobile reader are in active development.
    </p>

    <h2>How You Can Help</h2>
    <ul>
      <li>
        <strong>
          <a href="https://github.com/freed-project/freed" target="_blank" rel="noopener noreferrer">Star the repo</a>
          <span className="mx-2">⭐</span>
        </strong>{" "}
        It signals that this matters and helps others find it.
      </li>
      <li>
        <strong>
          <a href="https://app.freed.wtf" target="_blank" rel="noopener noreferrer">Try the PWA</a>
          <span className="mx-2">📱</span>
        </strong>{" "}
        Add some RSS feeds and tell me what's broken.
      </li>
      <li>
        <strong>
          <a href="https://github.com/freed-project/freed/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer">
            Contribute
          </a>
          <span className="mx-2">🛠️</span>
        </strong>{" "}
        Especially if you know Rust/TypeScript or have ideas for additional
        capture sources.
      </li>
      <li>
        <strong>Share <span className="mx-2">🤍</span></strong> Pass along to a
        friend who's complained about social media lately. We can win, together!
      </li>
    </ul>

    <h2>What's Next</h2>
    <ol>
      <li>Desktop-to-phone sync over LAN</li>
      <li>Notarized, downloadable desktop app for macOS</li>
      <li>Windows and Linux builds</li>
      <li>Cloud sync (Google Drive, Dropbox, iCloud)</li>
      <li>Facebook and Instagram capture</li>
    </ol>
    <p>
      I'll post an update when each of these ships.{" "}
      <a href="/roadmap">Follow along</a>!
    </p>
  </>,
);

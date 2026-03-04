import { definePost } from "../types";

export default definePost(
  {
    slug: "introducing-freed",
    title: "Introducing Freed: Take Back Your Feed",
    description:
      "Your feeds, your algorithms, your devices.",
    date: "2026-02-17",
    author: "Aubrey Falconer",
    authorUrl: "https://AubreyFalconer.com",
    tags: ["announcement", "philosophy", "technical"],
  },
  <>
    <p>
      The chronological feed was quietly killed by every major social platform.
      Because it failed to exploit you.
    </p>
    <p>
      What replaced it was engineered to keep you scrolling. Outrage gets
      amplified because it's engaging. Nuance gets buried because it's slow.
      Infinite scroll removes the stopping point. Variable reward schedules,
      the same mechanism that makes slot machines addictive, keep you pulling
      down to refresh. None of this is accidental. Billions of dollars in
      engineering talent were deployed specifically to exploit the gaps in human
      cognition.
    </p>
    <p>I built Freed because we can do better.</p>

    <h2>What Freed Is</h2>
    <p>
      Freed is a local-first feed reader. It captures content from the sources
      you choose: X, RSS feeds, YouTube channels, newsletters, and podcasts.
      Everything lands in a vault on your device, live-synced to your phone.
      You get a unified, chronological feed of everything you care about, ranked
      the way you decide. Your algorithm, your rules. The platforms become
      players in your game.
    </p>
    <ul>
      <li>
        <strong>No central servers.</strong> Your content lives on your device,
        synced between your own devices via Google Drive, iCloud, or Dropbox.
        I never see it.
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
        access X or Instagram. You get the content without the compulsion. Named
        after the hero who lashed himself to the mast so he could hear the
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
      X and RSS capture are working. Save for Later works: save any URL and
      Freed extracts the full article. The desktop app is running with capture,
      reader UI, and local sync. The PWA is live at{" "}
      <a href="https://app.freed.wtf">app.freed.wtf</a> with virtual scrolling,
      focus reading mode, and offline support. Active development on both.
    </p>

    <h2>How You Can Help</h2>
    <ul>
      <li>
        <strong>
          <a href="https://github.com/freed-project/freed">Star the repo.</a>
        </strong>{" "}
        It signals that this matters and helps others find it.
      </li>
      <li>
        <strong>
          <a href="https://app.freed.wtf">Try the PWA.</a>
        </strong>{" "}
        Add some RSS feeds and tell me what's broken.
      </li>
      <li>
        <strong>
          <a href="https://github.com/freed-project/freed/blob/main/CONTRIBUTING.md">
            Contribute.
          </a>
        </strong>{" "}
        Especially if you know Rust/TypeScript or have ideas for additional
        capture sources.
      </li>
      <li>
        <strong>Share this.</strong> Send it to someone who's complained about
        social media lately.
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
      I'll post an update when each of these lands.{" "}
      <a href="/updates">Follow along here.</a> I don't spam.
    </p>
  </>
);

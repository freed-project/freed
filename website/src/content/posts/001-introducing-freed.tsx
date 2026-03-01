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
      Welcome to the first Freed newsletter. If you're reading this, you've
      either subscribed to our email list or discovered us through RSS—which,
      by the way, is exactly the kind of choice we think you should always have.
    </p>

    <p>
      We want to tell you why we built this, how it works, and what we believe.
      Let's start with the problem we're trying to solve.
    </p>

    <h2>The Scroll That Doesn't End</h2>
    <p>
      Somewhere in the last decade, social media stopped being a place where you
      read things and became a place where things happened to you. The
      chronological feed—the simple idea that you see what the people you follow
      published, in the order they published it—was quietly killed at every major
      platform.
    </p>
    <p>
      What replaced it was algorithmic curation optimized for one thing:
      engagement. Not your satisfaction. Not your education. Not your
      connection to the people you care about. Engagement—clicks, shares,
      reactions, time-on-screen—because those are what platforms sell to
      advertisers.
    </p>
    <p>
      The results are predictable. Outrage gets amplified because it's
      engaging. Nuance gets suppressed because it's slow. The most compelling
      lies travel faster than measured truth, and the algorithm can't tell the
      difference and doesn't try. Infinite scroll removes the natural stopping
      point. Variable reward schedules—the same mechanism that makes slot
      machines addictive—keep you pulling down to refresh.
    </p>
    <p>
      None of this is accidental. It is the product of billions of dollars in
      engineering talent, deployed specifically to exploit the gaps in human
      cognition.
    </p>

    <h2>What Freed Does Differently</h2>
    <p>
      Freed is a local-first feed reader. It captures content from your social
      sources—X (formerly Twitter), RSS feeds, YouTube channels, newsletters,
      podcasts—and presents them in a unified, chronological timeline on your
      device. You decide the ranking. You control the weights. The algorithm is
      yours.
    </p>
    <p>Here's what that means concretely:</p>
    <ul>
      <li>
        <strong>No central servers.</strong> Your captured content lives on your
        device, synced between your own devices (laptop, phone) via your own
        cloud storage—Google Drive, iCloud, or Dropbox. We never touch it.
      </li>
      <li>
        <strong>No engagement optimization.</strong> Posts are ranked by
        criteria you define: how much you trust this author, how relevant the
        topic is to you, how fresh it is. Not by what made someone else angry
        yesterday.
      </li>
      <li>
        <strong>You can be done.</strong> Freed tracks what you've read. When
        you've seen everything from your subscribed sources, you've caught up.
        There's no infinite scroll. There's an actual end.
      </li>
      <li>
        <strong>Ulysses Mode.</strong> If you want to read content from X or
        Instagram but don't trust yourself not to lose two hours to the
        algorithmic feed, you can configure Freed to be the only way you access
        those platforms. Named after the Greek hero who had himself tied to the
        mast so he could hear the Sirens without dying.
      </li>
      <li>
        <strong>Open source.</strong> Every line of code is MIT licensed. You
        can read it, modify it, fork it, and audit exactly what it does with your
        data.
      </li>
    </ul>

    <h2>How It's Built</h2>
    <p>
      Freed is a monorepo with several packages that work together:
    </p>
    <ul>
      <li>
        <strong>Desktop app (Tauri + React)</strong>: The primary capture hub.
        Runs on macOS, Windows, and Linux. Captures from X using your existing
        browser session, polls RSS feeds, and hosts a local WebSocket relay for
        syncing to your phone.
      </li>
      <li>
        <strong>PWA (React + Vite)</strong>: A mobile-optimized reader that
        syncs with the desktop app when you're on the same network, and falls
        back to your cloud storage when you're not. Installed at{" "}
        <a href="https://app.freed.wtf">app.freed.wtf</a>.
      </li>
      <li>
        <strong>Shared library (@freed/shared)</strong>: The common types and
        Automerge CRDT schema that both apps use. The CRDT (Conflict-free
        Replicated Data Type) handles merging changes from multiple devices
        automatically—no sync conflicts, no data loss.
      </li>
      <li>
        <strong>Capture packages</strong>: Separate, composable packages for
        each source: <code>capture-x</code>, <code>capture-rss</code>,
        <code>capture-save</code>. Each one knows how to fetch from a source and
        normalize the result into a standard <code>FeedItem</code>.
      </li>
    </ul>
    <p>
      The architecture is deliberately local-first: data lives on your devices,
      syncs between them without a relay we operate, and degrades gracefully
      when offline. If we shut down tomorrow, your data and your app would keep
      working.
    </p>

    <h2>Where We Are</h2>
    <p>
      As of this writing, here's what's working:
    </p>
    <ul>
      <li>
        <strong>Foundation (Phase 1) ✓</strong>: Monorepo, shared types,
        Automerge schema, this marketing site, CI/CD.
      </li>
      <li>
        <strong>X + RSS capture (Phase 2) ✓</strong>: Both capture layers
        complete, with OPML import/export for RSS.
      </li>
      <li>
        <strong>Save for Later (Phase 3) ✓</strong>: Save any URL with full
        article extraction via Mozilla Readability.
      </li>
      <li>
        <strong>Desktop app (Phase 5) 🚧</strong>: The Tauri app is running with
        the local WebSocket relay, macOS vibrancy, X authentication, and the
        reader UI. Active development.
      </li>
      <li>
        <strong>PWA reader (Phase 6) 🚧</strong>: Deployed at{" "}
        <a href="https://app.freed.wtf">app.freed.wtf</a>. Virtual scrolling,
        focus reading mode, and service worker offline support just landed.
      </li>
    </ul>
    <p>
      The sync layer (Phase 4) is the critical path right now. Once local
      WebSocket sync is solid, the desktop and PWA can talk to each other
      reliably.
    </p>

    <h2>How You Can Help</h2>
    <p>
      We're a small team building this in public. The most valuable things you
      can do:
    </p>
    <ul>
      <li>
        <strong>Star the repo.</strong> It helps us understand how many people
        care about this, and it helps others discover the project.
      </li>
      <li>
        <strong>Try the PWA.</strong> Go to{" "}
        <a href="https://app.freed.wtf">app.freed.wtf</a>, add some RSS feeds,
        and tell us what's broken.
      </li>
      <li>
        <strong>Contribute code.</strong> Especially if you have Rust experience
        for the Tauri work, or if you have ideas for additional capture layers.
        Check the issues list.
      </li>
      <li>
        <strong>Share this.</strong> The people who need Freed most are the ones
        most embedded in the algorithmic feed. Send this to someone who's
        complained about social media lately.
      </li>
    </ul>

    <h2>What's Next</h2>
    <p>
      The immediate roadmap, in order:
    </p>
    <ol>
      <li>Finish the local sync layer (desktop ↔ phone over LAN)</li>
      <li>Polish the desktop and PWA UIs to a releasable state</li>
      <li>Package and notarize the desktop app for macOS</li>
      <li>Windows and Linux builds</li>
      <li>Facebook and Instagram capture via headless browser</li>
      <li>Cloud sync (Google Drive / Dropbox / iCloud)</li>
    </ol>
    <p>
      We'll send an update when each of these lands. We don't spam.
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

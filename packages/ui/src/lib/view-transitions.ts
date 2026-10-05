import { shouldEliminateMotion } from "./animation-preferences.js";

type ViewTransitionLike = {
  ready: Promise<void>;
  finished: Promise<void>;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransitionLike;
};

export function runFeedLayoutTransition(update: () => void): void {
  if (typeof window === "undefined" || shouldEliminateMotion()) {
    update();
    return;
  }

  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition) {
    update();
    return;
  }

  document.documentElement.classList.add("feed-layout-transition");

  try {
    const transition = doc.startViewTransition(() => {
      update();
    });

    // Resizing or replacing a transition can skip its animation while the DOM
    // update succeeds. Consume that animation-only rejection; update failures
    // still propagate through finished and the browser's updateCallbackDone.
    void transition.ready.catch(() => {});

    void transition.finished.finally(() => {
      document.documentElement.classList.remove("feed-layout-transition");
    });
  } catch {
    document.documentElement.classList.remove("feed-layout-transition");
    update();
  }
}

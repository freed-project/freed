import { shouldEliminateMotion } from "./animation-preferences.js";

type ViewTransitionLike = {
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

    void transition.finished.finally(() => {
      document.documentElement.classList.remove("feed-layout-transition");
    });
  } catch {
    document.documentElement.classList.remove("feed-layout-transition");
    update();
  }
}

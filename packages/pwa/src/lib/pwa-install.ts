const INSTALL_PROMPT_DISMISS_KEY = "freed.pwa.install.dismissed";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type InstallNotice =
  | { kind: "browser"; promptEvent: DeferredInstallPromptEvent }
  | { kind: "ios" };

export interface DeferredInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export function isStandalonePwa(win: Window = window): boolean {
  const displayModeStandalone = win.matchMedia?.("(display-mode: standalone)")?.matches === true;
  const navigatorStandalone = (win.navigator as NavigatorWithStandalone).standalone === true;
  return displayModeStandalone || navigatorStandalone;
}

export function dismissInstallNotice(storage: StorageLike = window.localStorage): void {
  storage.setItem(INSTALL_PROMPT_DISMISS_KEY, "1");
}

export function clearInstallNoticeDismissal(storage: StorageLike = window.localStorage): void {
  storage.removeItem(INSTALL_PROMPT_DISMISS_KEY);
}

export function isInstallNoticeDismissed(storage: StorageLike = window.localStorage): boolean {
  return storage.getItem(INSTALL_PROMPT_DISMISS_KEY) === "1";
}

export function isIosSafariInstallCandidate(win: Window = window): boolean {
  const ua = win.navigator.userAgent;
  const isIosDevice = /iPhone|iPad|iPod/.test(ua)
    || (ua.includes("Macintosh") && win.navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isIosDevice && isSafari;
}

export function getInitialInstallNotice(
  win: Window = window,
  storage: StorageLike = window.localStorage,
): InstallNotice | null {
  if (isStandalonePwa(win) || isInstallNoticeDismissed(storage)) {
    return null;
  }

  if (isIosSafariInstallCandidate(win)) {
    return { kind: "ios" };
  }

  return null;
}

export function watchInstallPrompt(
  callbacks: {
    onInstallPrompt: (notice: InstallNotice) => void;
    onInstalled: () => void;
  },
  win: Window = window,
  storage: StorageLike = window.localStorage,
): () => void {
  const handleBeforeInstallPrompt = (event: Event) => {
    if (isStandalonePwa(win) || isInstallNoticeDismissed(storage)) {
      return;
    }

    const promptEvent = event as DeferredInstallPromptEvent;
    promptEvent.preventDefault();
    callbacks.onInstallPrompt({ kind: "browser", promptEvent });
  };

  const handleInstalled = () => {
    clearInstallNoticeDismissal(storage);
    callbacks.onInstalled();
  };

  win.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
  win.addEventListener("appinstalled", handleInstalled);

  return () => {
    win.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
    win.removeEventListener("appinstalled", handleInstalled);
  };
}

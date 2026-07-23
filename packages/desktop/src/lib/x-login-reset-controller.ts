import { invoke } from "@tauri-apps/api/core";
import { registerDesktopProviderAuthQuiesceHandler } from "./provider-auth-lifecycle";

export interface XLoginResetController {
  markOpening(): void;
  trackOpening(operation: Promise<unknown>): void;
  markClosed(): void;
  closeForFactoryReset(): Promise<void>;
}

/** Keep the native X login window from surviving a reset and renderer reload. */
export function createXLoginResetController(
  closeWindow: () => Promise<void>,
): XLoginResetController {
  let windowMayBeOpen = false;
  let openingOperation: Promise<unknown> | null = null;

  return {
    markOpening() {
      windowMayBeOpen = true;
    },
    trackOpening(operation) {
      openingOperation = operation;
      void operation
        .finally(() => {
          if (openingOperation === operation) openingOperation = null;
        })
        .catch(() => {});
    },
    markClosed() {
      windowMayBeOpen = false;
    },
    async closeForFactoryReset() {
      const opening = openingOperation;
      if (opening) await Promise.allSettled([opening]);
      if (!windowMayBeOpen) return;
      windowMayBeOpen = false;
      await closeWindow();
    },
  };
}

/** Process-wide X login lifecycle, retained even when Settings is closed. */
export const desktopXLoginResetController = createXLoginResetController(
  async () => {
    await invoke("close_x_login_window");
  },
);

const quiesceDesktopXLogin = () =>
  desktopXLoginResetController.closeForFactoryReset();

/** Register the persistent X window closer with the shared provider reset barrier. */
export function registerDesktopXLoginResetHandler(): () => void {
  return registerDesktopProviderAuthQuiesceHandler(quiesceDesktopXLogin);
}

registerDesktopXLoginResetHandler();

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import {
  isRegistered,
  register,
  unregister,
} from "@tauri-apps/plugin-global-shortcut";
import {
  ClipboardSaveShortcutRegistrationController,
  createDefaultClipboardSaveShortcutConfig,
  loadClipboardSaveShortcutConfig,
  persistClipboardSaveShortcutConfig,
  type ClipboardSaveShortcutConfig,
  type ClipboardSaveShortcutStatus,
} from "../lib/clipboard-save-shortcut";
import { log } from "../lib/logger";

const LOADING_STATUS: ClipboardSaveShortcutStatus = {
  status: "loading",
  shortcut: null,
};

function hasTauriRuntime(): boolean {
  return import.meta.env.VITE_TEST_TAURI === "1" || isTauri();
}

export function useClipboardSaveShortcut(
  openSaveContentDialog: (initialUrl?: string) => void,
): {
  config: ClipboardSaveShortcutConfig | null;
  status: ClipboardSaveShortcutStatus;
  setConfig: (next: ClipboardSaveShortcutConfig) => Promise<void>;
  resetConfig: () => Promise<void>;
} {
  const [config, setConfigState] = useState<ClipboardSaveShortcutConfig | null>(null);
  const [status, setStatus] = useState<ClipboardSaveShortcutStatus>(LOADING_STATUS);

  useEffect(() => {
    let cancelled = false;
    void loadClipboardSaveShortcutConfig()
      .then((loaded) => {
        if (!cancelled) setConfigState(loaded);
      })
      .catch((error) => {
        log.warn(
          `[shortcuts] failed to load clipboard save shortcut: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (!cancelled) {
          const fallback = createDefaultClipboardSaveShortcutConfig();
          setConfigState(fallback);
          setStatus({
            status: "error",
            shortcut: fallback.shortcut,
            message: "Could not load shortcut settings.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const controller = useMemo(
    () =>
      new ClipboardSaveShortcutRegistrationController({
        register,
        unregister,
        isRegistered,
        readClipboardText: readText,
        showWindow: async () => {
          await invoke("show_window");
        },
        openSaveContentDialog,
        onError: (error) => {
          log.warn(
            `[shortcuts] clipboard save shortcut failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      }),
    [openSaveContentDialog],
  );

  useEffect(() => {
    let cancelled = false;
    if (!config) {
      setStatus(LOADING_STATUS);
      return () => {
        cancelled = true;
      };
    }

    if (!hasTauriRuntime()) {
      setStatus({
        status: "disabled",
        shortcut: config.enabled ? config.shortcut : null,
        message: "Global shortcuts are available in Freed Desktop.",
      });
      return () => {
        cancelled = true;
      };
    }

    void controller.apply(config).then((nextStatus) => {
      if (!cancelled) setStatus(nextStatus);
    });

    return () => {
      cancelled = true;
      void controller.dispose();
    };
  }, [config, controller]);

  const setConfig = useCallback(async (next: ClipboardSaveShortcutConfig) => {
    setConfigState(next);
    try {
      await persistClipboardSaveShortcutConfig(next);
    } catch (error) {
      log.warn(
        `[shortcuts] failed to persist clipboard save shortcut: ${error instanceof Error ? error.message : String(error)}`,
      );
      setStatus({
        status: "error",
        shortcut: next.enabled ? next.shortcut : null,
        message: "Could not save shortcut settings.",
      });
    }
  }, []);

  const resetConfig = useCallback(async () => {
    await setConfig(createDefaultClipboardSaveShortcutConfig());
  }, [setConfig]);

  return {
    config,
    status,
    setConfig,
    resetConfig,
  };
}

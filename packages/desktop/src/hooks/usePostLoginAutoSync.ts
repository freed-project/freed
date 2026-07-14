import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { canUseTauriEvents } from "../lib/tauri-runtime";
import {
  isDesktopProviderAuthAllowed,
  registerDesktopProviderAuthQuiesceHandler,
} from "../lib/provider-auth-lifecycle";

type PostLoginSyncState = "idle" | "starting" | "healthy" | "failed";

interface UsePostLoginAutoSyncOptions {
  authEvent: string;
  loginWindowClosedEvent: string;
  scrapeHealthyEvent: string;
  scrapeStartFailedEvent: string;
  hideLoginCommand: string;
  providerLabel: string;
  isAuthenticated: () => boolean;
  onAuthResult: (loggedIn: boolean) => void;
  runSync: (trigger?: "post_login") => Promise<void>;
}

interface PostLoginAutoSyncState {
  pending: boolean;
  status: PostLoginSyncState;
  message: string | null;
  cancel: () => void;
}

function closeDelayMs(): number {
  return 1_200 + Math.floor(Math.random() * 3_600);
}

export function usePostLoginAutoSync({
  authEvent,
  loginWindowClosedEvent,
  scrapeHealthyEvent,
  scrapeStartFailedEvent,
  hideLoginCommand,
  providerLabel,
  isAuthenticated,
  onAuthResult,
  runSync,
}: UsePostLoginAutoSyncOptions): PostLoginAutoSyncState {
  const [status, setStatus] = useState<PostLoginSyncState>("idle");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const statusRef = useRef<PostLoginSyncState>("idle");
  const closeTimerRef = useRef<number | null>(null);
  const runSyncRef = useRef(runSync);
  const isAuthenticatedRef = useRef(isAuthenticated);
  const onAuthResultRef = useRef(onAuthResult);

  useEffect(() => {
    runSyncRef.current = runSync;
  }, [runSync]);

  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    onAuthResultRef.current = onAuthResult;
  }, [onAuthResult]);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    clearCloseTimer();
    pendingRef.current = false;
    statusRef.current = "idle";
    setPending(false);
    setStatus("idle");
  }, [clearCloseTimer]);

  const quiesce = useCallback(() => {
    clearCloseTimer();
    pendingRef.current = false;
    statusRef.current = "idle";
  }, [clearCloseTimer]);

  useEffect(
    () => registerDesktopProviderAuthQuiesceHandler(quiesce),
    [quiesce],
  );

  const scheduleLoginClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      if (!isDesktopProviderAuthAllowed()) return;
      if (!pendingRef.current || !isAuthenticatedRef.current()) return;
      pendingRef.current = false;
      statusRef.current = "idle";
      setPending(false);
      setStatus("idle");
      invoke(hideLoginCommand).catch(() => {});
    }, closeDelayMs());
  }, [clearCloseTimer, hideLoginCommand]);

  useEffect(() => {
    return clearCloseTimer;
  }, [clearCloseTimer]);

  useEffect(() => {
    if (!canUseTauriEvents()) return;

    const unlisten = listen<{ loggedIn: boolean }>(authEvent, (event) => {
      if (!isDesktopProviderAuthAllowed()) return;
      const loggedIn = event.payload.loggedIn;
      onAuthResultRef.current(loggedIn);
      if (loggedIn && pendingRef.current) return;
      clearCloseTimer();

      if (!loggedIn) {
        pendingRef.current = false;
        statusRef.current = "idle";
        setPending(false);
        setStatus("idle");
        return;
      }

      pendingRef.current = true;
      statusRef.current = "starting";
      setPending(true);
      setStatus("starting");
      void runSyncRef.current("post_login").then(() => {
        if (!isDesktopProviderAuthAllowed()) return;
        if (!pendingRef.current || statusRef.current === "healthy") return;
        statusRef.current = "failed";
        setStatus("failed");
      }).catch(() => {
        if (!isDesktopProviderAuthAllowed()) return;
        if (!pendingRef.current) return;
        statusRef.current = "failed";
        setStatus("failed");
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [authEvent, clearCloseTimer]);

  useEffect(() => {
    if (!canUseTauriEvents()) return;

    const unlisten = listen<{ closed: boolean }>(loginWindowClosedEvent, (event) => {
      if (!isDesktopProviderAuthAllowed()) return;
      if (!event.payload.closed) return;
      cancel();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [cancel, loginWindowClosedEvent]);

  useEffect(() => {
    if (!canUseTauriEvents()) return;

    const unlisten = listen(scrapeHealthyEvent, () => {
      if (!isDesktopProviderAuthAllowed()) return;
      if (!pendingRef.current || !isAuthenticatedRef.current()) return;
      statusRef.current = "healthy";
      setStatus("healthy");
      scheduleLoginClose();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [scheduleLoginClose, scrapeHealthyEvent]);

  useEffect(() => {
    if (!canUseTauriEvents()) return;

    const unlisten = listen(scrapeStartFailedEvent, () => {
      if (!isDesktopProviderAuthAllowed()) return;
      if (!pendingRef.current) return;
      clearCloseTimer();
      statusRef.current = "failed";
      setStatus("failed");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [clearCloseTimer, scrapeStartFailedEvent]);

  const message = (() => {
    if (!pending) return null;
    if (status === "failed") {
      return `Connected, but sync did not start. Finish any ${providerLabel} prompts, then close the login window or click Sync Now.`;
    }
    if (status === "healthy") {
      return `Connected. Sync started. Finish any ${providerLabel} prompts while Freed closes the login window.`;
    }
    return `Connected. Starting sync. Finish any ${providerLabel} prompts while Freed checks the session.`;
  })();

  return {
    pending,
    status,
    message,
    cancel,
  };
}

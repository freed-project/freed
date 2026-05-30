import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { clearPlatformUA, selectPlatformUA } from "./user-agent";

export interface MediumAuthState {
  isAuthenticated: boolean;
  lastCheckedAt?: number;
  lastCapturedAt?: number;
  lastCaptureError?: string;
  pausedUntil?: number;
  pauseReason?: string;
  pauseLevel?: 1 | 2 | 3;
}

const MEDIUM_AUTH_KEY = "medium_auth_state";

export async function showMediumLogin(): Promise<void> {
  const userAgent = selectPlatformUA("medium");
  await invoke("medium_show_login", { userAgent });
}

export async function checkMediumAuth(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let unlisten: UnlistenFn | null = null;
    const timeout = setTimeout(() => {
      unlisten?.();
      resolve(false);
    }, 15_000);

    listen<{ loggedIn: boolean }>("medium-auth-result", (event) => {
      clearTimeout(timeout);
      unlisten?.();
      resolve(event.payload.loggedIn);
    }).then((fn) => {
      unlisten = fn;
    });

    invoke("medium_check_auth").catch(() => {
      clearTimeout(timeout);
      unlisten?.();
      resolve(false);
    });
  });
}

export async function disconnectMedium(): Promise<void> {
  await invoke("medium_disconnect");
  localStorage.removeItem(MEDIUM_AUTH_KEY);
  clearPlatformUA("medium");
}

export function storeMediumAuthState(state: MediumAuthState): void {
  localStorage.setItem(MEDIUM_AUTH_KEY, JSON.stringify(state));
}

export function initMediumAuth(): MediumAuthState {
  const stored = localStorage.getItem(MEDIUM_AUTH_KEY);
  if (!stored) return { isAuthenticated: false };
  try {
    const parsed = JSON.parse(stored) as MediumAuthState;
    return {
      isAuthenticated: !!parsed.isAuthenticated,
      lastCheckedAt: parsed.lastCheckedAt,
      lastCapturedAt: parsed.lastCapturedAt,
      lastCaptureError: parsed.lastCaptureError,
      pausedUntil: parsed.pausedUntil,
      pauseReason: parsed.pauseReason,
      pauseLevel: parsed.pauseLevel,
    };
  } catch {
    return { isAuthenticated: false };
  }
}

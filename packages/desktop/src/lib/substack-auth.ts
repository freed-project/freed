import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { clearPlatformUA, selectPlatformUA } from "./user-agent";

export interface SubstackAuthState {
  isAuthenticated: boolean;
  lastCheckedAt?: number;
  lastCapturedAt?: number;
  lastCaptureError?: string;
  pausedUntil?: number;
  pauseReason?: string;
  pauseLevel?: 1 | 2 | 3;
}

const SUBSTACK_AUTH_KEY = "substack_auth_state";

export async function showSubstackLogin(): Promise<void> {
  const userAgent = selectPlatformUA("substack");
  await invoke("substack_show_login", { userAgent });
}

export async function checkSubstackAuth(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let unlisten: UnlistenFn | null = null;
    const timeout = setTimeout(() => {
      unlisten?.();
      resolve(false);
    }, 15_000);

    listen<{ loggedIn: boolean }>("substack-auth-result", (event) => {
      clearTimeout(timeout);
      unlisten?.();
      resolve(event.payload.loggedIn);
    }).then((fn) => {
      unlisten = fn;
    });

    invoke("substack_check_auth").catch(() => {
      clearTimeout(timeout);
      unlisten?.();
      resolve(false);
    });
  });
}

export async function disconnectSubstack(): Promise<void> {
  await invoke("substack_disconnect");
  localStorage.removeItem(SUBSTACK_AUTH_KEY);
  clearPlatformUA("substack");
}

export function storeSubstackAuthState(state: SubstackAuthState): void {
  localStorage.setItem(SUBSTACK_AUTH_KEY, JSON.stringify(state));
}

export function initSubstackAuth(): SubstackAuthState {
  const stored = localStorage.getItem(SUBSTACK_AUTH_KEY);
  if (!stored) return { isAuthenticated: false };
  try {
    const parsed = JSON.parse(stored) as SubstackAuthState;
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

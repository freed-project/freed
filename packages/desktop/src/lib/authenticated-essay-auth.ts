import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { clearPlatformUA, getPlatformUA } from "./user-agent";
import { safeUnlisten } from "./safe-unlisten";

type AuthenticatedEssayAuthProvider = "substack" | "medium";

export interface AuthenticatedEssayAuthState {
  isAuthenticated: boolean;
  lastCheckedAt?: number;
  lastCapturedAt?: number;
  lastCaptureError?: string;
  captureCooldownUntil?: number;
  pausedUntil?: number;
  pauseReason?: string;
  pauseLevel?: 1 | 2 | 3;
}

interface AuthenticatedEssayAuthConfig {
  provider: AuthenticatedEssayAuthProvider;
  storageKey: string;
  authEvent: `${AuthenticatedEssayAuthProvider}-auth-result`;
  showLoginCommand: `${AuthenticatedEssayAuthProvider}_show_login`;
  checkAuthCommand: `${AuthenticatedEssayAuthProvider}_check_auth`;
  disconnectCommand: `${AuthenticatedEssayAuthProvider}_disconnect`;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseStoredAuthState(value: string | null): AuthenticatedEssayAuthState {
  if (!value) return { isAuthenticated: false };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const pauseLevel = parsed.pauseLevel;
    return {
      isAuthenticated: parsed.isAuthenticated === true,
      lastCheckedAt: finiteNumber(parsed.lastCheckedAt),
      lastCapturedAt: finiteNumber(parsed.lastCapturedAt),
      lastCaptureError:
        typeof parsed.lastCaptureError === "string" ? parsed.lastCaptureError : undefined,
      captureCooldownUntil: finiteNumber(parsed.captureCooldownUntil),
      pausedUntil: finiteNumber(parsed.pausedUntil),
      pauseReason: typeof parsed.pauseReason === "string" ? parsed.pauseReason : undefined,
      pauseLevel:
        pauseLevel === 1 || pauseLevel === 2 || pauseLevel === 3 ? pauseLevel : undefined,
    };
  } catch {
    return { isAuthenticated: false };
  }
}

export function createAuthenticatedEssayAuth(config: AuthenticatedEssayAuthConfig) {
  const showLogin = async (): Promise<void> => {
    const userAgent = getPlatformUA(config.provider);
    await invoke(config.showLoginCommand, { userAgent });
  };

  const checkAuth = async (): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      let unlisten: UnlistenFn | null = null;
      let settled = false;
      const settle = (loggedIn: boolean, label: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        safeUnlisten(unlisten, label);
        resolve(loggedIn);
      };
      const timeout = setTimeout(() => {
        settle(false, `${config.authEvent}:timeout`);
      }, 15_000);

      void listen<{ loggedIn: boolean }>(config.authEvent, (event) => {
        settle(event.payload.loggedIn, config.authEvent);
      })
        .then((fn) => {
          unlisten = fn;
          if (settled) {
            safeUnlisten(unlisten, `${config.authEvent}:late-listener`);
            return;
          }
          return invoke(config.checkAuthCommand, {
            userAgent: getPlatformUA(config.provider),
          });
        })
        .catch(() => {
          settle(false, `${config.authEvent}:error`);
        });
    });

  const disconnect = async (): Promise<void> => {
    try {
      await invoke(config.disconnectCommand);
    } finally {
      localStorage.removeItem(config.storageKey);
      clearPlatformUA(config.provider);
    }
  };

  const storeAuthState = (state: AuthenticatedEssayAuthState): void => {
    localStorage.setItem(config.storageKey, JSON.stringify(state));
  };

  const initAuth = (): AuthenticatedEssayAuthState =>
    parseStoredAuthState(localStorage.getItem(config.storageKey));

  return { showLogin, checkAuth, disconnect, storeAuthState, initAuth };
}

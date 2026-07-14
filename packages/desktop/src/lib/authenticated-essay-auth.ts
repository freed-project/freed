import { invoke } from "@tauri-apps/api/core";
import { clearPlatformUA, getPlatformUA } from "./user-agent";
import {
  isDesktopProviderAuthAllowed,
  requestDesktopProviderAuthCheck,
  runDesktopProviderAuthRequest,
} from "./provider-auth-lifecycle";
import { persistDisconnectedSocialAuthStateForFactoryReset } from "./social-auth-transient-errors";

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
  providerLabel: "Substack" | "Medium";
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
    if (!isDesktopProviderAuthAllowed()) return;
    await runDesktopProviderAuthRequest(async () => {
      const userAgent = getPlatformUA(config.provider);
      await invoke(config.showLoginCommand, { userAgent });
    });
  };

  const checkAuth = async (): Promise<boolean> => {
    if (!isDesktopProviderAuthAllowed()) return false;
    return requestDesktopProviderAuthCheck<{ loggedIn: boolean }>({
      eventName: config.authEvent,
      command: config.checkAuthCommand,
      invokeArgs: { userAgent: getPlatformUA(config.provider) },
      timeoutMs: 15_000,
      isLoggedIn: (payload) => payload.loggedIn,
    });
  };

  const disconnect = async (): Promise<void> => {
    try {
      await invoke(config.disconnectCommand);
    } finally {
      localStorage.removeItem(config.storageKey);
      clearPlatformUA(config.provider);
    }
  };

  const disconnectForFactoryReset = async (): Promise<void> => {
    persistDisconnectedSocialAuthStateForFactoryReset(
      config.storageKey,
      config.providerLabel,
    );
    await invoke(config.disconnectCommand);
  };

  const storeAuthState = (state: AuthenticatedEssayAuthState): void => {
    if (!isDesktopProviderAuthAllowed()) return;
    localStorage.setItem(config.storageKey, JSON.stringify(state));
  };

  const initAuth = (): AuthenticatedEssayAuthState =>
    parseStoredAuthState(localStorage.getItem(config.storageKey));

  return {
    showLogin,
    checkAuth,
    disconnect,
    disconnectForFactoryReset,
    storeAuthState,
    initAuth,
  };
}

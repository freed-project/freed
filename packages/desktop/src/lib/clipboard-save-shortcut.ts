import { readNativeJsonFile, writeNativeJsonFile } from "./native-json-store";

const STORE_FILE = "clipboard-save-shortcut.json";
const MAC_DEFAULT_SHORTCUT = "Control+Option+Command+S";
const OTHER_DEFAULT_SHORTCUT = "Control+Alt+S";

export type ClipboardSaveShortcutStatusKind =
  | "loading"
  | "active"
  | "disabled"
  | "conflict"
  | "error";

export interface ClipboardSaveShortcutConfig {
  enabled: boolean;
  shortcut: string;
}

export interface ClipboardSaveShortcutStatus {
  status: ClipboardSaveShortcutStatusKind;
  shortcut: string | null;
  message?: string;
}

export interface GlobalShortcutEvent {
  shortcut: string;
  state?: "Pressed" | "Released";
}

export interface ClipboardSaveShortcutRegistrationDeps {
  register: (
    shortcut: string,
    handler: (event: GlobalShortcutEvent) => void | Promise<void>,
  ) => Promise<void>;
  unregister: (shortcut: string) => Promise<void>;
  isRegistered: (shortcut: string) => Promise<boolean>;
  readClipboardText: () => Promise<string>;
  showWindow: () => Promise<void>;
  openSaveContentDialog: (initialUrl?: string) => void;
  onError?: (error: unknown) => void;
}

function currentPlatformText(): string {
  if (typeof navigator === "undefined") return "";
  return `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
}

export function isMacPlatform(platformText = currentPlatformText()): boolean {
  return /mac|darwin/i.test(platformText);
}

export function defaultClipboardSaveShortcut(
  platformText = currentPlatformText(),
): string {
  return isMacPlatform(platformText) ? MAC_DEFAULT_SHORTCUT : OTHER_DEFAULT_SHORTCUT;
}

export function createDefaultClipboardSaveShortcutConfig(
  platformText = currentPlatformText(),
): ClipboardSaveShortcutConfig {
  return {
    enabled: true,
    shortcut: defaultClipboardSaveShortcut(platformText),
  };
}

function normalizeStoredConfig(
  value: Record<string, unknown> | null,
): ClipboardSaveShortcutConfig | null {
  if (!value) return null;
  const enabled = value.enabled;
  const shortcut = value.shortcut;
  if (typeof enabled !== "boolean" || typeof shortcut !== "string") {
    return null;
  }
  const trimmed = shortcut.trim();
  if (!trimmed) {
    return null;
  }
  return {
    enabled,
    shortcut: trimmed,
  };
}

export async function loadClipboardSaveShortcutConfig(): Promise<ClipboardSaveShortcutConfig> {
  const stored = normalizeStoredConfig(await readNativeJsonFile(STORE_FILE));
  return stored ?? createDefaultClipboardSaveShortcutConfig();
}

export async function persistClipboardSaveShortcutConfig(
  config: ClipboardSaveShortcutConfig,
): Promise<void> {
  await writeNativeJsonFile(STORE_FILE, { ...config }, "clipboard-save-shortcut");
}

export function normalizeClipboardUrl(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function formatShortcutForDisplay(
  shortcut: string,
  platformText = currentPlatformText(),
): string {
  const displayParts = formatShortcutForDisplayParts(shortcut, platformText);
  return isMacPlatform(platformText) ? displayParts.join("") : displayParts.join("+");
}

export function formatShortcutForDisplayParts(
  shortcut: string,
  platformText = currentPlatformText(),
): string[] {
  const parts = shortcut.split("+").map((part) => part.trim()).filter(Boolean);
  if (isMacPlatform(platformText)) {
    return parts.map((part) => {
      switch (part.toLowerCase()) {
        case "command":
        case "cmd":
        case "meta":
          return "⌘";
        case "control":
        case "ctrl":
          return "⌃";
        case "option":
        case "alt":
          return "⌥";
        case "shift":
          return "⇧";
        case "space":
          return "Space";
        default:
          return part.length === 1 ? part.toUpperCase() : part;
      }
    });
  }

  return parts.map((part) => {
    if (/^ctrl$/i.test(part)) return "Control";
    return part.length === 1 ? part.toUpperCase() : part;
  });
}

function keyFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = event.key;
  if (!key || ["Alt", "Control", "Meta", "Shift"].includes(key)) {
    return null;
  }
  if (key === " ") return "Space";
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key.toUpperCase();
  if (["Escape", "Tab", "Enter", "Backspace", "Delete"].includes(key)) return key;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return key;
  return null;
}

export function shortcutFromKeyboardEvent(
  event: KeyboardEvent,
  platformText = currentPlatformText(),
): string | null {
  const key = keyFromKeyboardEvent(event);
  if (!key) return null;

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push(isMacPlatform(platformText) ? "Option" : "Alt");
  if (event.metaKey) modifiers.push(isMacPlatform(platformText) ? "Command" : "Meta");
  if (event.shiftKey) modifiers.push("Shift");
  if (modifiers.length === 0) return null;

  return [...modifiers, key].join("+");
}

function registrationErrorStatus(
  shortcut: string,
  error: unknown,
): ClipboardSaveShortcutStatus {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(already|registered|taken|busy|in use)\b/i.test(message)) {
    return {
      status: "conflict",
      shortcut,
      message: "That shortcut is already in use. Pick another combination.",
    };
  }
  return {
    status: "error",
    shortcut,
    message: message || "Could not register shortcut.",
  };
}

export class ClipboardSaveShortcutRegistrationController {
  private registeredShortcut: string | null = null;

  constructor(private readonly deps: ClipboardSaveShortcutRegistrationDeps) {}

  async apply(
    config: ClipboardSaveShortcutConfig,
  ): Promise<ClipboardSaveShortcutStatus> {
    if (this.registeredShortcut && this.registeredShortcut !== config.shortcut) {
      await this.unregisterCurrent();
    }

    if (!config.enabled) {
      await this.unregisterCurrent();
      return { status: "disabled", shortcut: null };
    }

    if (this.registeredShortcut === config.shortcut) {
      return { status: "active", shortcut: config.shortcut };
    }

    try {
      if (await this.deps.isRegistered(config.shortcut)) {
        await this.deps.unregister(config.shortcut);
      }

      await this.deps.register(config.shortcut, async (event) => {
        if (event.state && event.state !== "Pressed") return;
        try {
          const clipboardText = await this.deps.readClipboardText();
          const initialUrl = normalizeClipboardUrl(clipboardText) ?? undefined;
          await this.deps.showWindow();
          this.deps.openSaveContentDialog(initialUrl);
        } catch (error) {
          this.deps.onError?.(error);
          await this.deps.showWindow().catch(() => undefined);
          this.deps.openSaveContentDialog();
        }
      });
      this.registeredShortcut = config.shortcut;
      return { status: "active", shortcut: config.shortcut };
    } catch (error) {
      this.registeredShortcut = null;
      return registrationErrorStatus(config.shortcut, error);
    }
  }

  async dispose(): Promise<void> {
    await this.unregisterCurrent();
  }

  private async unregisterCurrent(): Promise<void> {
    const current = this.registeredShortcut;
    this.registeredShortcut = null;
    if (!current) return;
    try {
      await this.deps.unregister(current);
    } catch (error) {
      this.deps.onError?.(error);
    }
  }
}

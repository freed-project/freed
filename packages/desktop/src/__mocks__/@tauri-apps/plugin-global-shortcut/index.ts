type ShortcutEvent = {
  shortcut: string;
  state: "Pressed" | "Released";
};

type ShortcutHandler = (event: ShortcutEvent) => void | Promise<void>;

type MockWindow = Window & {
  __TAURI_MOCK_GLOBAL_SHORTCUTS__?: Record<string, ShortcutHandler>;
  __TAURI_MOCK_GLOBAL_SHORTCUT_CALLS__?: Array<{
    action: "register" | "unregister" | "unregisterAll" | "isRegistered";
    shortcut?: string;
  }>;
  __TAURI_MOCK_GLOBAL_SHORTCUT_CONFLICTS__?: string[];
  __TAURI_MOCK_TRIGGER_GLOBAL_SHORTCUT__?: (
    shortcut: string,
    state?: "Pressed" | "Released",
  ) => Promise<void>;
};

function mockWindow(): MockWindow {
  return window as MockWindow;
}

function shortcuts(): Record<string, ShortcutHandler> {
  const win = mockWindow();
  win.__TAURI_MOCK_GLOBAL_SHORTCUTS__ ??= {};
  return win.__TAURI_MOCK_GLOBAL_SHORTCUTS__;
}

function calls(): MockWindow["__TAURI_MOCK_GLOBAL_SHORTCUT_CALLS__"] {
  const win = mockWindow();
  win.__TAURI_MOCK_GLOBAL_SHORTCUT_CALLS__ ??= [];
  return win.__TAURI_MOCK_GLOBAL_SHORTCUT_CALLS__;
}

async function triggerGlobalShortcut(
  shortcut: string,
  state: "Pressed" | "Released" = "Pressed",
): Promise<void> {
  const handler = shortcuts()[shortcut];
  if (handler) {
    await handler({ shortcut, state });
  }
}

mockWindow().__TAURI_MOCK_TRIGGER_GLOBAL_SHORTCUT__ = triggerGlobalShortcut;

export async function register(
  shortcut: string,
  handler: ShortcutHandler,
): Promise<void> {
  calls()?.push({ action: "register", shortcut });
  if (mockWindow().__TAURI_MOCK_GLOBAL_SHORTCUT_CONFLICTS__?.includes(shortcut)) {
    throw new Error("Shortcut already registered");
  }
  shortcuts()[shortcut] = handler;
}

export async function unregister(shortcut: string): Promise<void> {
  calls()?.push({ action: "unregister", shortcut });
  delete shortcuts()[shortcut];
}

export async function unregisterAll(): Promise<void> {
  calls()?.push({ action: "unregisterAll" });
  mockWindow().__TAURI_MOCK_GLOBAL_SHORTCUTS__ = {};
}

export async function isRegistered(shortcut: string): Promise<boolean> {
  calls()?.push({ action: "isRegistered", shortcut });
  return shortcut in shortcuts();
}

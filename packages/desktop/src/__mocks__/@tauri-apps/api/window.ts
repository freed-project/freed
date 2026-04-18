type MockWindowDragCall = {
  label: string;
  timestamp: number;
};

function getWindowDragCalls(): MockWindowDragCall[] {
  const win = window as unknown as Record<string, unknown>;
  const existing = win.__TAURI_MOCK_WINDOW_DRAG_CALLS__;
  if (Array.isArray(existing)) {
    return existing as MockWindowDragCall[];
  }

  const created: MockWindowDragCall[] = [];
  win.__TAURI_MOCK_WINDOW_DRAG_CALLS__ = created;
  return created;
}

export function getCurrentWindow() {
  const win = window as unknown as Record<string, unknown>;
  const tauriInternals = (win.__TAURI_INTERNALS__ ?? {}) as {
    metadata?: { currentWindow?: { label?: string } };
  };
  const label = tauriInternals.metadata?.currentWindow?.label ?? "main";

  return {
    label,
    async startDragging(): Promise<void> {
      getWindowDragCalls().push({
        label,
        timestamp: Date.now(),
      });
    },
  };
}

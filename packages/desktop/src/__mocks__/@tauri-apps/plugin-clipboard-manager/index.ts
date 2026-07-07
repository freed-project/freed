type MockClipboardWindow = Window & {
  __TAURI_MOCK_CLIPBOARD_TEXT__?: string;
};

function mockWindow(): MockClipboardWindow {
  return window as MockClipboardWindow;
}

export async function readText(): Promise<string> {
  return mockWindow().__TAURI_MOCK_CLIPBOARD_TEXT__ ?? "";
}

export async function writeText(text: string): Promise<void> {
  mockWindow().__TAURI_MOCK_CLIPBOARD_TEXT__ = text;
}

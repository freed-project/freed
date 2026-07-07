import { isTauri } from "@tauri-apps/api/core";

export function canUseTauriEvents(): boolean {
  if (isTauri()) return true;
  if (typeof window === "undefined") return false;
  return import.meta.env.VITE_TEST_TAURI === "1" || "__TAURI_INTERNALS__" in window;
}

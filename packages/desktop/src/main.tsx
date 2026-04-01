import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import * as automerge from "./lib/automerge";
import { useAppStore } from "./lib/store";
import "./index.css";

// Expose internal modules on window so E2E performance tests can inject data
// directly without going through the UI. Only active in VITE_TEST_TAURI=1 mode.
if (import.meta.env.VITE_TEST_TAURI) {
  const w = window as unknown as Record<string, unknown>;
  w.__FREED_STORE__ = useAppStore;
  w.__FREED_AUTOMERGE__ = automerge;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

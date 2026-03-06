import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Expose internal modules on window so E2E performance tests can inject data
// directly without going through the UI. Only active in VITE_TEST_TAURI=1 mode.
if (import.meta.env.VITE_TEST_TAURI) {
  Promise.all([import("./lib/store"), import("./lib/automerge")]).then(
    ([store, automerge]) => {
      const w = window as Record<string, unknown>;
      w.__FREED_STORE__ = store.useAppStore;
      w.__FREED_AUTOMERGE__ = automerge;
    },
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

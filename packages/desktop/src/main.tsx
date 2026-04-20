import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapDocumentTheme } from "@freed/ui/lib/theme";
import App from "./App";
import * as automerge from "./lib/automerge";
import { useAppStore } from "./lib/store";
import "./index.css";
import { installConsoleBugReportCapture, installGlobalBugReportCapture } from "@freed/ui/lib/bug-report";

bootstrapDocumentTheme();

const previewLabel = import.meta.env.VITE_FREED_PREVIEW_LABEL?.trim() || "";

if (previewLabel) {
  document.title = `Freed Preview | ${previewLabel}`;
}

// Expose internal modules on window so E2E performance tests can inject data
// directly without going through the UI. Only active in VITE_TEST_TAURI=1 mode.
if (import.meta.env.VITE_TEST_TAURI) {
  const w = window as unknown as Record<string, unknown>;
  w.__FREED_STORE__ = useAppStore;
  w.__FREED_AUTOMERGE__ = automerge;
}

installGlobalBugReportCapture("desktop");
installConsoleBugReportCapture("desktop");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

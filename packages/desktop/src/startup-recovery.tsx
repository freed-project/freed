import { createRoot } from "react-dom/client";
import { bootstrapDocumentTheme } from "@freed/ui/lib/theme";
import { StartupRecoveryScreen } from "./components/StartupRecoveryScreen";
import "./index.css";

bootstrapDocumentTheme();

createRoot(document.getElementById("root")!).render(
  <StartupRecoveryScreen />,
);

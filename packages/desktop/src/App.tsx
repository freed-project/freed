import { AppShell } from "./components/layout/AppShell";
import { FeedView } from "./components/feed/FeedView";

function App() {
  return (
    <div className="h-screen flex flex-col bg-transparent">
      <AppShell>
        <FeedView />
      </AppShell>
    </div>
  );
}

export default App;

// Extend Window interface for Tauri
declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke: (
          cmd: string,
          args?: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    };
  }
}

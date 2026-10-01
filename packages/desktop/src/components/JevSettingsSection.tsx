import { useEffect, useRef, useState } from "react";
import { ApiKeyInput } from "@freed/ui/components/settings/AISection";
import { isJevNative, jevCredentials, testJevConnection } from "../lib/jev-client";
import { JevClassificationPreview } from "./JevClassificationPreview";

/** Jev is independent of the summary provider and never updates synced AI preferences. */
export function JevSettingsSection() {
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function test() {
    const active = new AbortController();
    controller.current = active;
    setTesting(true); setMessage(null);
    try {
      await testJevConnection(active.signal);
      if (!active.signal.aborted) setMessage("Connected to Jev. Ready to evaluate posts.");
    } catch (error) {
      if (!active.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not connect to Jev.");
    } finally { if (!active.signal.aborted) setTesting(false); }
  }
  return <section aria-label="Jev settings" className="space-y-3 rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-surface)] p-4">
    <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Jev</h3>
    <p className="text-xs leading-5 text-[var(--theme-text-muted)]">Classify posts, find people you can help, and explore collaboration. Bring your own TypeSafe API key. Jev runs separately from your summary provider.</p>
    <ApiKeyInput provider="jev" {...jevCredentials} onChanged={() => { controller.current?.abort(); setTesting(false); setMessage(null); }} />
    <p className="text-xs text-[var(--theme-text-soft)]">{isJevNative ? "Stored in this device’s system credential vault. Never synced." : "Browser preview: the key stays in this tab’s memory until reload. Requests pass through this private preview server without saving the key."}</p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={testing} onClick={() => void test()} className="theme-toolbar-button-ghost rounded-lg px-3 py-1.5 text-xs disabled:opacity-40">{testing ? "Testing…" : "Test connection"}</button>
      <span className="text-xs text-[var(--theme-text-muted)]">Sends a short example to Jev and may incur API usage.</span>
    </div>
    {message && <p role="status" className="text-xs text-[var(--theme-text-secondary)]">{message}</p>}
    <JevClassificationPreview embedded />
  </section>;
}

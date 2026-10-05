import { useEffect, useRef, useState } from "react";
import { ApiKeyInput } from "@freed/ui/components/settings/AISection";
import { isJevNative, jevCredentials, testJevConnection } from "../lib/jev-client";
import { JevSpendingLimits } from "./JevSpendingLimits";
import { getJevClassifierProvider, setJevClassifierProvider, type JevClassifierProvider } from "../lib/jev-provider";
import { gliclassModels, GLICLASS_MANIFEST, removeLocalGliclass } from "../lib/gliclass-client";
import { subscribeToLocalAIModelState } from "../lib/local-ai-models";
import { JevClassificationPreview } from "./JevClassificationPreview";

/** Jev is independent of the summary provider and never updates synced AI preferences. */
export function JevSettingsSection() {
  const [provider, setProvider] = useState(getJevClassifierProvider);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(0);
  const [localStatus, setLocalStatus] = useState("not_downloaded");
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); void gliclassModels.pauseDownload("gliclass-base"); }, []);
  useEffect(() => {
    if (!isJevNative) return;
    let disposed = false;
    const refresh = () => { void gliclassModels.listModels().then(models => {
      if (disposed) return;
      setLocalStatus(models[0]?.state.status ?? "not_downloaded");
      if (models[0]?.state.status === "error") setMessage(models[0].state.lastError ?? "Local model unavailable.");
    }).catch(error => { if (!disposed) setMessage(error instanceof Error ? error.message : "Could not read local model status."); }); };
    refresh();
    const unsubscribe = subscribeToLocalAIModelState(refresh);
    return () => { disposed = true; unsubscribe(); };
  }, []);
  async function download() {
    setDownloadBusy(true); setMessage(null);
    try {
      const models = await gliclassModels.downloadModel("gliclass-base", progress => setDownloaded(progress.downloadedBytes));
      setLocalStatus(models[0]?.state.status ?? "error");
      setJevClassifierProvider(getJevClassifierProvider());
      if (models[0]?.state.status === "error") setMessage(models[0].state.lastError ?? "Could not download GLiClass.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not download GLiClass."); }
    finally { setDownloadBusy(false); }
  }
  async function select(provider: JevClassifierProvider) {
    controller.current?.abort(); setTesting(false); setMessage(null);
    if (downloadBusy) await gliclassModels.pauseDownload("gliclass-base");
    setJevClassifierProvider(provider); setProvider(provider);
    if (provider === "gliclass-base" && localStatus !== "available") await download();
  }
  async function remove() {
    try { await removeLocalGliclass(); setLocalStatus("not_downloaded"); setDownloaded(0); setJevClassifierProvider(getJevClassifierProvider()); }
    catch (error) { setMessage(typeof error === "string" ? error : error instanceof Error ? error.message : "Could not remove the model."); }
  }
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
    <p className="text-xs leading-5 text-[var(--theme-text-muted)]">Classify posts, find people you can help, and explore collaboration. Choose the Jev API or optional local GLiClass Base classification. This selection is separate from your summary provider.</p>
    <label className="block text-xs">Classifier<select aria-label="Classifier provider" value={provider} onChange={event => void select(event.target.value as JevClassifierProvider)} className="ml-2 rounded border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] p-2"><option value="jev">Jev API</option><option value="gliclass-base" disabled={!isJevNative}>GLiClass Base v3.0 · local CPU</option></select></label>
    {provider === "jev" ? <>
    <JevSpendingLimits />
    <ApiKeyInput provider="jev" {...jevCredentials} onChanged={() => { controller.current?.abort(); setTesting(false); setMessage(null); }} />
    <p className="text-xs text-[var(--theme-text-soft)]">{isJevNative ? "Stored in this device’s system credential vault. Never synced." : "Browser preview: the key stays in this tab’s memory until reload. Paid Jev requests require the native app and its durable spending limits."}</p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={testing} onClick={() => void test()} className="theme-toolbar-button-ghost rounded-lg px-3 py-1.5 text-xs disabled:opacity-40">{testing ? "Testing…" : "Test connection"}</button>
      <span className="text-xs text-[var(--theme-text-muted)]">Sends a short example to Jev and may incur API usage.</span>
    </div>
    </> : <div className="space-y-2 text-xs text-[var(--theme-text-secondary)]">
      <p>Experimental local post signals, with no API key or cloud fallback. Selecting this model downloads official Apache-2.0 weights and tokenizer from Hugging Face ({GLICLASS_MANIFEST.estimatedDownloadBytes.toLocaleString()} bytes). Classification runs locally after download. Capability matching currently requires an explicit switch to Jev.</p>
      <p>Its accuracy and thresholds have not been established as equivalent to Jev. Long inputs abstain when they exceed the token limit.</p>
      <p role="status">{downloadBusy ? `Downloading ${downloaded.toLocaleString()} / ${GLICLASS_MANIFEST.estimatedDownloadBytes.toLocaleString()} bytes` : localStatus === "available" ? "Local model ready. Works offline." : localStatus === "paused" ? "Download paused. Resume to continue." : "Local model not downloaded."}</p>
      {downloadBusy ? <button type="button" className="theme-toolbar-button-ghost rounded-lg px-3 py-1.5" onClick={() => void gliclassModels.pauseDownload("gliclass-base").then(() => setLocalStatus("paused"))}>Cancel download</button> : <button type="button" className="theme-toolbar-button-ghost rounded-lg px-3 py-1.5" onClick={() => void download()} disabled={localStatus === "available"}>Download or resume</button>}
      <button type="button" disabled={downloadBusy} className="theme-toolbar-button-ghost rounded-lg px-3 py-1.5" onClick={() => void remove()}>Remove model and release memory</button>
    </div>}
    {message && <p role="status" className="text-xs text-[var(--theme-text-secondary)]">{message}</p>}
    <JevClassificationPreview embedded />
  </section>;
}

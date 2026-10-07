import { LIBRARY_TRANSFER_ENABLED, LIBRARY_TRANSFER_UNAVAILABLE } from "../lib/library-transfer-capability";
import { ConsumerRecoveryReview } from "./ConsumerRecoveryReview";
import { useCloudProviders } from "../hooks/useCloudProviders";
import { useEffect, useRef, useState } from "react";
import { readLibraryCoreDesktopRole, refreshLibraryCoreDesktopRole } from "../lib/library-core-desktop-role";
import { getValidCloudToken } from "../lib/sync";
import { readNormalizedLibraryHandoffStatus, type NormalizedLibraryHandoffStatus } from "../lib/sqlite-library";
import {
  prepareDesktopLibraryTargetReadiness, prepareDesktopLibrarySourceHandoff,
  cancelDesktopLibrarySourceHandoff, authorizeDesktopLibrarySourceHandoff,
  acceptDesktopLibraryTargetHandoffAuthorization, acceptDesktopLibraryTargetHandoffCancellation, catchUpDesktopLibraryTargetHandoff,
  stageDesktopLibraryTargetHandoff, publishDesktopLibraryTargetHandoff,
  activateDesktopLibraryTargetHandoff, adoptDesktopLibrarySourceHandoff,
} from "../lib/library-core-handoff";

const button = "rounded-lg border border-[var(--theme-border-strong)] px-3 py-2 text-sm text-[var(--theme-text-primary)] disabled:opacity-50";
const field = "w-full rounded-lg border border-[var(--theme-border-strong)] bg-[var(--theme-bg-input)] p-2 text-xs text-[var(--theme-text-primary)]";

/** Durable phase readback decides which action is available after every restart. */
export function LibraryHandoffPanel() {
  if (!LIBRARY_TRANSFER_ENABLED) return <section aria-label="Primary transfer"><h2>Primary transfer</h2><p>{LIBRARY_TRANSFER_UNAVAILABLE}</p><ConsumerRecoveryReview readOnly /></section>;
  return <EnabledLibraryHandoffPanel />;
}

function EnabledLibraryHandoffPanel() {
  const credentials = useCloudProviders({ credentialsOnly: true });
  const signingIn = credentials.providers.gdrive.status === "connecting";
  const [cancellationInput, setCancellationInput] = useState("");
  const [status, setStatus] = useState<NormalizedLibraryHandoffStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [viewer, setViewer] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [target, setTarget] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void Promise.all([readNormalizedLibraryHandoffStatus(), refreshLibraryCoreDesktopRole()]).then(([value, installation]) => {
      if (alive.current) { setStatus(value); setViewer(installation?.state === "read_only_consumer"); setLoaded(true); }
    }).catch(failure => { if (alive.current) setError(String(failure)); });
    return () => { alive.current = false; operation.current?.abort(); };
  }, []);
  async function run(action: (signal: AbortSignal) => Promise<unknown>) {
    if (operation.current || signingIn) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError(null); setCopied(false);
    try { await action(controller.signal); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally {
      try {
        const current = await readNormalizedLibraryHandoffStatus();
        if (alive.current) { setStatus(current); setLoaded(true); }
        const installation = await refreshLibraryCoreDesktopRole();
        if (alive.current) setViewer(installation?.state === "read_only_consumer");
      } catch (failure) { if (alive.current) setError(String(failure)); }
      operation.current = null;
      if (alive.current) setBusy(false);
    }
  }
  async function cloud(signal: AbortSignal) {
    const accessToken = await getValidCloudToken("gdrive");
    if (signal.aborted) throw new DOMException("Transfer interrupted", "AbortError");
    if (!accessToken) throw new Error("Reconnect Google Drive below, then retry this transfer step.");
    return { handoffId: status!.handoffId, accessToken, signal };
  }
  const fresh = loaded && (!status || status.phase === "cancelled"
    || (status.installationRole === "target" && status.phase === "active")
    || (status.installationRole === "consumer" && status.phase === "following")
    || (status.installationRole === "source" && status.phase === "demoted"));
  const source = status?.installationRole === "source";
  const targetRole = status?.installationRole === "target";
  const role = readLibraryCoreDesktopRole();
  let targetActorId: string | null = null;
  try {
    const actor = status && JSON.parse(status.canonicalReadiness).body?.target_actor_id;
    if (typeof actor === "string" && /^[a-f0-9]{64}$/.test(actor)) targetActorId = actor;
  } catch { /* Native readback errors remain visible; never infer another target. */ }
  const cancellation = status?.phase === "cancelled" ? status.canonicalCancellation : null;
  const receipt = cancellation || (source ? status?.canonicalAuthorization : targetRole ? status?.canonicalReadiness : null);
  return <section aria-label="Primary transfer" className="mb-5 space-y-3 rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4">
    <h2 className="font-semibold text-[var(--theme-text-primary)]">Primary transfer</h2>
    <p className="text-sm text-[var(--theme-text-secondary)]">Join the new Freed Desktop as a consumer first and sync until its edits are accepted. Exchange the signed receipts between your two installations. Only the current Primary can authorize the move.</p>
    {!loaded && !error && <p role="status">Checking the saved transfer...</p>}
    {status && <p className="text-sm">Transfer ...{status.handoffId.slice(-8)} · {source ? status.phase === "demoted" ? "Former Primary" : "Current Primary" : targetRole && status.phase !== "cancelled" ? "New Primary" : "Consumer"} · {{ preparing: "Preparation saved", sealed: "Source paused", authorized: "Move authorized", cas_pending: "Ready to publish", active: "Activation saved", demoted: "Consumer selected", cancelled: "Canceled", committed: "Publication saved", recovery: "Recovery required", following: "Following successor" }[status.phase]}</p>}
    {fresh && viewer === false && role === "follower" && <button className={button} disabled={busy || signingIn} onClick={() => void run(() => prepareDesktopLibraryTargetReadiness())}>Prepare this device as the new Primary</button>}
    {fresh && role === "primary" && <>
      <label className="block text-sm">New device readiness receipt<textarea className={field} rows={4} maxLength={16384} value={input} onChange={e => { setInput(e.target.value); setConfirmed(false); }} /></label>
      <label className="block text-sm">Target actor ID from the new device<input className={field} value={target} maxLength={64} onChange={e => { setTarget(e.target.value); setConfirmed(false); }} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I checked the target device. Pause this Primary and prepare its final checkpoint.</label>
      <button className={button} disabled={busy || signingIn || !confirmed || !/^[a-f0-9]{64}$/.test(target)} onClick={() => void run(() => prepareDesktopLibrarySourceHandoff({ canonicalReadiness: input, selectedTargetActorId: target }))}>Pause and prepare transfer</button>
    </>}
    {cancellation && <p className="text-sm">{source ? "The source canceled this transfer. Save its signed cancellation receipt." : "This device is a consumer again. The canceled transfer cannot be resumed."}</p>}
    {receipt && <>
      <label className="block text-sm">{cancellation ? (source ? "Signed cancellation for the target device" : "Verified cancellation from the current Primary") : source ? "Signed authorization for the new device" : "Readiness receipt for the current Primary"}<textarea readOnly rows={4} className={field} value={receipt} /></label>
      <button className={button} disabled={busy || signingIn} onClick={() => void navigator.clipboard.writeText(receipt).then(() => setCopied(true)).catch(failure => setError(String(failure)))}>{copied ? "Receipt copied" : "Copy receipt"}</button>
    </>}
    {targetRole && targetActorId && <div className="text-sm">Target device ...{targetActorId.slice(-8)} <button className={button} disabled={busy || signingIn} onClick={() => void navigator.clipboard.writeText(targetActorId!).then(() => setCopied(true)).catch(failure => setError(String(failure)))}>Copy target actor ID</button></div>}
    {source && ["preparing", "sealed"].includes(status!.phase) && <>
      <p className="text-sm">The source is paused. Cancellation is available only before signed authorization.</p>
      {status!.phase === "preparing" && targetActorId && <button className={button} disabled={busy || signingIn} onClick={() => void run(() => prepareDesktopLibrarySourceHandoff({ canonicalReadiness: status!.canonicalReadiness, selectedTargetActorId: targetActorId! }))}>Resume pausing this Primary</button>}
      {status!.phase === "sealed" && <button className={button} disabled={busy || signingIn} onClick={() => void run(async signal => authorizeDesktopLibrarySourceHandoff(await cloud(signal)))}>Publish final checkpoint and authorize move</button>}
      <button className={button} disabled={busy || signingIn} onClick={() => void run(() => cancelDesktopLibrarySourceHandoff(status!.handoffId))}>Cancel unapproved transfer</button>
    </>}
    {source && status!.phase === "authorized" && !status!.canonicalAuthorization && <>
      <p className="text-sm">Authorization was committed before signing finished. Resume the same authorization; this source remains paused.</p>
      <button className={button} disabled={busy || signingIn} onClick={() => void run(signal => authorizeDesktopLibrarySourceHandoff({ handoffId: status!.handoffId, accessToken: "", signal }))}>Finish signed authorization</button>
    </>}
    {source && ["authorized", "demoted"].includes(status!.phase) && status!.canonicalAuthorization && <>
      <p className="text-sm">{status!.phase === "demoted"
        ? viewer ? "This device is a read-only viewer. It receives updates without creating Library edits, including automatic read or seen changes."
          : "This device follows the successor as an editable consumer."
        : "After the new Primary finishes activation, verify its checkpoint and choose how this device follows it. Read-only viewers receive updates without editing the Library."}</p>
      <button className={button} disabled={busy || signingIn || viewer === null} onClick={() => void run(async signal => {
        const request = status!.phase === "demoted" ? { handoffId: status!.handoffId, accessToken: "", signal } : await cloud(signal);
        return adoptDesktopLibrarySourceHandoff({ ...request, readOnly: viewer === true });
      })}>{viewer ? "Verify successor and continue as read-only viewer" : "Verify successor and continue as consumer"}</button>
      {status!.phase === "authorized" && <button className={button} disabled={busy || signingIn || viewer === null} onClick={() => void run(async signal => {
        return adoptDesktopLibrarySourceHandoff({ ...await cloud(signal), readOnly: true });
      })}>Verify successor and continue as read-only viewer</button>}
    </>}
    {targetRole && status!.phase === "preparing" && !status!.canonicalAuthorization && <>
      <label className="block text-sm">Signed authorization from the current Primary<textarea className={field} rows={4} maxLength={16384} value={input} onChange={e => setInput(e.target.value)} /></label>
      <button className={button} disabled={busy || signingIn || !input} onClick={() => void run(() => acceptDesktopLibraryTargetHandoffAuthorization(input))}>Verify and accept authorization</button>
      <p className="text-sm">If the source canceled this transfer, paste its signed cancellation to return to consumer operation. An authorized transfer must finish.</p>
      <label className="block text-sm">Signed cancellation from the current Primary<textarea className={field} rows={4} maxLength={16384} value={cancellationInput} onChange={e => setCancellationInput(e.target.value)} /></label>
      <button className={button} disabled={busy || signingIn || !cancellationInput} onClick={() => void run(() => acceptDesktopLibraryTargetHandoffCancellation(cancellationInput))}>Verify cancellation and resume as consumer</button>
    </>}
    {targetRole && status!.phase === "preparing" && status!.canonicalAuthorization && <button className={button} disabled={busy || signingIn} onClick={() => void run(async signal => {
      await catchUpDesktopLibraryTargetHandoff(await cloud(signal));
      if (!signal.aborted) await stageDesktopLibraryTargetHandoff(status!.handoffId);
    })}>Download final checkpoint and stage this Primary</button>}
    {targetRole && ["cas_pending", "active"].includes(status!.phase) && <button className={button} disabled={busy || signingIn} onClick={() => void run(async signal => {
      const request = status!.phase === "active" ? { handoffId: status!.handoffId, accessToken: "", signal } : await cloud(signal);
      if (status!.phase === "cas_pending") await publishDesktopLibraryTargetHandoff(request);
      if (!signal.aborted) await activateDesktopLibraryTargetHandoff({ ...request, onActivated: () => {} });
    })}>{status!.phase === "active" ? "Verify completed activation" : "Publish and activate this Primary"}</button>}
    {status && (source || targetRole) && !["cancelled", "active", "demoted"].includes(status.phase) && <div className="space-y-2 border-t border-[var(--theme-border-subtle)] pt-3">
      <p className="text-sm text-[var(--theme-text-secondary)]">If Google Drive access expired, reconnect here. Sign-in keeps the transfer paused; retry the transfer step afterward.</p>
      <button className={button} disabled={busy || signingIn} onClick={() => { setError(null); void credentials.connect("gdrive"); }}>{signingIn ? "Signing in to Google Drive..." : "Reconnect Google Drive"}</button>
      {signingIn && <button className={button} onClick={() => credentials.cancelConnect("gdrive")}>Cancel sign-in</button>}
      {credentials.providers.gdrive.status === "connected" && <p role="status" className="text-sm">Sign-in saved. Retry the transfer step above.</p>}
      {credentials.providers.gdrive.status === "error" && <p role="alert" className="text-sm theme-feedback-text-danger">{credentials.providers.gdrive.error}</p>}
    </div>}
    {status && status.installationRole !== "consumer" && (role !== "follower" || (source && status.phase === "demoted")) && <div className="border-t border-[var(--theme-border-subtle)] pt-3">
      <h3 className="text-sm font-semibold">Preserved edits</h3>
      <ConsumerRecoveryReview key={`${status.handoffId}:${status.phase}:${role}`} primary={role === "primary"} readOnly={viewer !== false || !((source && status.phase === "demoted" && role === "follower") || (targetRole && status.phase === "active" && role === "primary"))} />
    </div>}
    {busy && <p role="status" className="text-sm">Transfer step is running. Native work may finish after this view closes; the saved receipt determines the next step.</p>}
    {error && <p role="alert" className="text-sm theme-feedback-text-danger">{error}</p>}
    {!loaded && error && <button className={button} onClick={() => void run(async () => {})}>Retry transfer check</button>}
  </section>;
}

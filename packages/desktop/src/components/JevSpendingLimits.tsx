import { useEffect, useState } from "react";
import { getJevBudget, setJevBudget, onJevBudgetChange, type JevBudgetStatus } from "../lib/jev-client";
const money = (nano: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(nano / 1e9);
/** Conservative full-request reservations; never presented as vendor billing. */
export function JevSpendingLimits() {
  const [daily, setDaily] = useState("1");
  const [monthly, setMonthly] = useState("10");
  const [total, setTotal] = useState("");
  const [status, setStatus] = useState<JevBudgetStatus | null>(null);
  const [message, setMessage] = useState("Save your limits to enable paid Jev requests.");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; const refresh = () => { void getJevBudget().then(value => {
    if (!active || !value) return;
    setStatus(value); setDaily(String(value.limits.dailyNanoUsd / 1e9)); setMonthly(String(value.limits.monthlyNanoUsd / 1e9)); setTotal(value.limits.totalNanoUsd === null ? "" : String(value.limits.totalNanoUsd / 1e9)); setMessage("Limits enabled.");
  }).catch(() => { if (active) setMessage("Spending history unavailable. Jev requests are blocked."); }); }; refresh(); const stop = onJevBudgetChange(refresh); return () => { active = false; stop(); }; }, []);
  async function save() {
    const values = [daily, monthly, ...(total ? [total] : [])].map(Number);
    if (values.some(value => !Number.isFinite(value) || value <= 0 || value > 1000)) { setMessage("Enter positive USD limits up to $1,000."); return; }
    setBusy(true);
    try { setStatus(await setJevBudget({ dailyNanoUsd: Math.floor(Number(daily) * 1e9), monthlyNanoUsd: Math.floor(Number(monthly) * 1e9), totalNanoUsd: total ? Math.floor(Number(total) * 1e9) : null })); setMessage("Limits saved. Existing reservations are preserved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save Jev limits."); }
    finally { setBusy(false); }
  }
  return <fieldset className="space-y-2 rounded-lg border border-[var(--theme-border-subtle)] p-3">
    <legend className="text-sm font-semibold">Jev spending limits (USD)</legend>
    <p className="text-xs text-[var(--theme-text-muted)]">Daily and calendar-month limits reset at midnight UTC. The lowest remaining limit applies. An optional total limit never resets.</p>
    <div className="flex flex-wrap gap-3">{([
      ["Daily limit", daily, setDaily], ["Monthly limit", monthly, setMonthly], ["Optional total limit", total, setTotal],
    ] as const).map(([label, value, change]) => <label key={label} className="text-xs">{label}<input type="number" min="0.000001" max="1000" step="any" value={value} onChange={event => change(event.target.value)} className="mt-1 block w-32 rounded border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-surface)] p-2" /></label>)}</div>
    <p className="text-xs text-[var(--theme-text-muted)]">Before each call, Freed reserves $0.002752512: a conservative 65,536-token request bound at TypeSafe’s published $0.042 per million input tokens (output free). With the default limits this allows at most 363 requests per UTC day and 3,633 per calendar month. Reservations stay counted after cancellation or errors, including a missing key before any provider contact. These conservative estimates are not billed charges; check TypeSafe for your actual bill. Pricing is pinned to jev-1.13.0 and was verified on October 2, 2026; vendor price changes or account-specific pricing can differ. Limits apply on this device, not across other clients.</p>
    {status && <p className="text-xs">Reserved today: {money(status.dailyReservedNanoUsd)}; this month: {money(status.monthlyReservedNanoUsd)}; total: {money(status.totalReservedNanoUsd)}.</p>}
    <p className="text-xs text-[var(--theme-text-muted)]">At a limit, use local GLiClass when available, or adjust the limits. App updates and Library restores preserve this separate spending history. Removing the device profile removes its history; do not remove it to reset spending.</p>
    <button type="button" disabled={busy} onClick={() => void save()} className="theme-toolbar-button-ghost rounded-lg px-3 py-1.5 text-xs disabled:opacity-40">{busy ? "Saving…" : "Save limits and enable Jev"}</button>
    <p role="status" className="text-xs">{message}</p>
  </fieldset>;
}

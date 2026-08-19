/** Copy one exact JSON value without changing its field names or scalar values. */
export async function copyExactJsonToClipboard(value: unknown): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable.");
  }
  await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
}

/** Parse a meta date as epoch milliseconds, omitting missing or invalid dates. */
export function parseMetaTimestamp(value: string | undefined): number | undefined {
  const timestamp = value ? new Date(value).getTime() : undefined;
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

const clockTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const shortClockTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const debugClockTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const monthDayClockTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const mediumDateShortTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function toDate(value: number | string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatClockTime(value: number | string | Date): string {
  return clockTimeFormatter.format(toDate(value));
}

export function formatShortClockTime(value: number | string | Date): string {
  return shortClockTimeFormatter.format(toDate(value));
}

export function formatDebugClockTime(value: number | string | Date): string {
  return debugClockTimeFormatter.format(toDate(value));
}

export function formatMonthDayClockTime(value: number | string | Date): string {
  return monthDayClockTimeFormatter.format(toDate(value));
}

export function formatMediumDateShortTime(value: number | string | Date): string {
  return mediumDateShortTimeFormatter.format(toDate(value));
}

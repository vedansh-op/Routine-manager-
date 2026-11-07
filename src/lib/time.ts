export const DEFAULT_USER_TIME_ZONE = "Asia/Kolkata";
export const DEFAULT_PARTNER_TIME_ZONE = "Europe/Lisbon";

export function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_USER_TIME_ZONE;
  } catch {
    return DEFAULT_USER_TIME_ZONE;
  }
}

export function formatInTimeZone(
  value: Date | string | number,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      ...options,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

export function getTimeZoneOffsetLabel(value: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(value);
    return parts.find(part => part.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

export function getDateKeyInTimeZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** A timestamp represents one instant; each member formats it in their own IANA zone. */
export function toUtcIso(value: Date = new Date()): string {
  return value.toISOString();
}

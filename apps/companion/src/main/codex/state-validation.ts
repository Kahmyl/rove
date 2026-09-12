export function strictRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}

export function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra !== undefined)
    throw new Error(`${label} contains unsupported field ${extra}.`);
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Invalid ${label}.`);
  return value;
}

export function boundedIdentity(
  value: unknown,
  label: string,
  pattern: RegExp = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,255}$/,
): string {
  const parsed = requiredString(value, label);
  if (!pattern.test(parsed)) throw new Error(`Invalid ${label}.`);
  return parsed;
}

export function boundedOpaqueIdentity(
  value: unknown,
  label: string,
  maximum = 256,
): string {
  const parsed = requiredString(value, label);
  if (parsed.length > maximum) throw new Error(`Invalid ${label}.`);
  return parsed;
}

export function strictRfc3339(value: unknown, label: string): string {
  const parsed = requiredString(value, label);
  const match = parsed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match) throw new Error(`Invalid ${label}.`);
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    (offsetHourText !== undefined && Number(offsetHourText) > 23) ||
    (offsetMinuteText !== undefined && Number(offsetMinuteText) > 59) ||
    !Number.isFinite(Date.parse(parsed))
  )
    throw new Error(`Invalid ${label}.`);
  return parsed;
}

export function sha256Digest(value: unknown, label: string): string {
  const parsed = requiredString(value, label);
  if (!/^[a-f0-9]{64}$/.test(parsed)) throw new Error(`Invalid ${label}.`);
  return parsed;
}

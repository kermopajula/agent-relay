const DEFAULT_WAIT_SECONDS = 50;
const MAX_WAIT_SECONDS = 120;
const DEFAULT_TIMEOUT_HOURS = 6;
const MAX_TIMEOUT_HOURS = 168;

function parseNumber(raw: string | undefined): number {
  return raw === undefined || raw.trim() === "" ? NaN : Number(raw);
}

export function waitSeconds(raw: string | undefined): number {
  const parsed = parseNumber(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_WAIT_SECONDS;
  return Math.min(MAX_WAIT_SECONDS, Math.max(0, parsed));
}

/** Hours without a final report before a task counts as timed out. */
export function taskTimeoutHours(raw: string | undefined): number {
  const parsed = parseNumber(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_HOURS;
  return Math.min(MAX_TIMEOUT_HOURS, parsed);
}

/** A valid IANA time zone name, or UTC. */
export function timeZoneOrUtc(raw: string | null | undefined): string {
  if (!raw || raw.trim() === "") return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: raw.trim() });
    return raw.trim();
  } catch {
    return "UTC";
  }
}

/** With no ALLOWED_ORIGINS set every origin passes; a request without Origin always passes. */
export function originAllowed(origin: string | null, allowed: string | undefined): boolean {
  if (origin === null || !allowed || allowed.trim() === "") return true;
  return allowed
    .split(",")
    .map((o) => o.trim())
    .includes(origin);
}

const DEFAULT_WAIT_SECONDS = 50;
const MAX_WAIT_SECONDS = 120;

export function waitSeconds(raw: string | undefined): number {
  const parsed = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_WAIT_SECONDS;
  return Math.min(MAX_WAIT_SECONDS, Math.max(0, parsed));
}

/** With no ALLOWED_ORIGINS set every origin passes; a request without Origin always passes. */
export function originAllowed(origin: string | null, allowed: string | undefined): boolean {
  if (origin === null || !allowed || allowed.trim() === "") return true;
  return allowed
    .split(",")
    .map((o) => o.trim())
    .includes(origin);
}

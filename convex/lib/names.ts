const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SLUG_LENGTH = 40;

export function isSlug(name: string): boolean {
  return name.length <= MAX_SLUG_LENGTH && SLUG.test(name);
}

/** "legacy-monolith" becomes "Legacy Monolith". */
export function displayNameFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatClock(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(ms),
  );
}

/** What a task is called until Claude reports a name. */
export function provisionalName(projectDisplayName: string, sentAt: number, timeZone: string): string {
  return `new ${projectDisplayName} task, sent ${formatClock(sentAt, timeZone)}`;
}

/** Returns `base`, or `base (2)`, `base (3)` and so on, whichever is not taken. */
export function dedupeName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!used.has(candidate)) return candidate;
  }
}

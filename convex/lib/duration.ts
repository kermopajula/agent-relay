export const DURATIONS = [2, 10, 30] as const;
export type Duration = (typeof DURATIONS)[number];

const WORDS: Record<string, Duration> = { two: 2, ten: 10, thirty: 30 };

const NUMERIC = /\b(2|10|30)\s*-?\s*(?:min|mins|minute|minutes|m)\b/i;
const SPELLED = /\b(two|ten|thirty)\s*-?\s*(?:min|mins|minute|minutes)\b/i;
const HALF_HOUR = /\bhalf\s+an?\s+hour\b/i;

/** Finds a 2, 10 or 30 minute duration in free text, as typed or as voice transcribes it. */
export function parseDuration(text: string): Duration | null {
  const numeric = NUMERIC.exec(text);
  if (numeric?.[1]) return Number(numeric[1]) as Duration;
  const spelled = SPELLED.exec(text);
  if (spelled?.[1]) return WORDS[spelled[1].toLowerCase()] ?? null;
  if (HALF_HOUR.test(text)) return 30;
  return null;
}

/** Task 1 gets 2 minutes, task 2 gets 10, task 3 gets 30, task 4 gets 2 again. */
export function cycledDuration(taskNumber: number): Duration {
  return DURATIONS[(taskNumber - 1) % DURATIONS.length] ?? 2;
}

export function chooseDuration(text: string, taskNumber: number): Duration {
  return parseDuration(text) ?? cycledDuration(taskNumber);
}

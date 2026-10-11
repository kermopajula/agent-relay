type Named = { name: string; number: number };

const LATEST_WORDS = new Set(["", "last", "latest", "the last one", "most recent", "recent"]);
const TASK_NUMBER = /\btask\s*(?:number\s*)?#?\s*(\d+)\b/i;

/**
 * Picks a task by spoken name. `tasks` must be newest first.
 * Order: latest keyword, exact name, "task N", prefix, substring.
 */
export function matchTask<T extends Named>(tasks: T[], rawName: string | undefined): T | null {
  const name = (rawName ?? "").trim().toLowerCase();
  if (LATEST_WORDS.has(name)) return tasks[0] ?? null;

  const exact = tasks.find((t) => t.name.toLowerCase() === name);
  if (exact) return exact;

  const numbered = TASK_NUMBER.exec(name) ?? /^#?(\d+)$/.exec(name);
  if (numbered?.[1]) {
    const wanted = Number(numbered[1]);
    return tasks.find((t) => t.number === wanted) ?? null;
  }

  return (
    tasks.find((t) => t.name.toLowerCase().startsWith(name)) ??
    tasks.find((t) => t.name.toLowerCase().includes(name)) ??
    null
  );
}

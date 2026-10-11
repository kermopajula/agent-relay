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

export type MatchableProject = { name: string; displayName: string; aliases?: string[]; isDefault: boolean };

export type ProjectMatch<T> =
  | { kind: "match"; project: T }
  | { kind: "ambiguous"; candidates: T[] }
  | { kind: "unknown"; known: T[] }
  | { kind: "no_projects" }
  | { kind: "no_default"; known: T[] };

// Words people say around a project name that never name one.
const FILLER = new Set(["the", "a", "an", "my", "our", "project", "projects", "repo", "repository", "inbox", "routine"]);

function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

export function spokenTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "" && !FILLER.has(word))
    .map(stem);
}

function projectKeys(project: MatchableProject): string[][] {
  return [project.name, project.displayName, ...(project.aliases ?? [])].map(spokenTokens).filter((k) => k.length > 0);
}

function decide<T>(found: T[]): ProjectMatch<T> | null {
  if (found.length === 1 && found[0]) return { kind: "match", project: found[0] };
  if (found.length > 1) return { kind: "ambiguous", candidates: found };
  return null;
}

/**
 * Picks a project from a spoken name such as "bugs", "the bug project" or
 * "Begin Mobile". An empty name, or one made only of filler words, picks the
 * default. Order: exact name or alias, all words present, all words as prefixes.
 */
export function matchProject<T extends MatchableProject>(projects: T[], rawName: string | undefined): ProjectMatch<T> {
  if (projects.length === 0) return { kind: "no_projects" };
  const wanted = spokenTokens(rawName ?? "");
  if (wanted.length === 0) {
    const fallback = projects.find((p) => p.isDefault);
    return fallback ? { kind: "match", project: fallback } : { kind: "no_default", known: projects };
  }
  const joined = wanted.join(" ");
  const exact = projects.filter((p) => projectKeys(p).some((key) => key.join(" ") === joined));
  const subset = projects.filter((p) => projectKeys(p).some((key) => wanted.every((w) => key.includes(w))));
  const prefix = projects.filter((p) =>
    projectKeys(p).some((key) => wanted.every((w) => w.length >= 2 && key.some((k) => k.startsWith(w)))),
  );
  return decide(exact) ?? decide(subset) ?? decide(prefix) ?? { kind: "unknown", known: projects };
}

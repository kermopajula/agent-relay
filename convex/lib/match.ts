type NamedTask = { name: string; sentName: string };

// Words around a task name that never name one. With nothing else left, the
// newest task is meant ("the last one", "my task").
const TASK_FILLER = new Set(["task", "tasks", "job", "last", "latest", "recent", "most", "one", "newest"]);

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/^["']|["'.?!]$/g, "").replace(/\s+/g, " ");
}

/**
 * Picks a task by spoken name. `tasks` must be newest first. A task matches by
 * its reported name or by the provisional name it had when sent.
 * Order: newest, exact name, prefix, substring, all spoken words present.
 */
export function matchTask<T extends NamedTask>(tasks: T[], rawName: string | undefined): T | null {
  const name = normalize(rawName ?? "");
  const words = spokenTokens(name).filter((w) => !TASK_FILLER.has(w));
  if (words.length === 0) return tasks[0] ?? null;
  const names = (t: T) => [normalize(t.name), normalize(t.sentName)];
  return (
    tasks.find((t) => names(t).includes(name)) ??
    tasks.find((t) => names(t).some((n) => n.startsWith(name))) ??
    tasks.find((t) => names(t).some((n) => n.includes(name))) ??
    tasks.find((t) => names(t).some((n) => words.every((w) => spokenTokens(n).includes(w)))) ??
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
 * Picks a project from a spoken name such as "monolith", "the monolith project" or
 * "Legacy Monolith". An empty name, or one made only of filler words, picks the
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

import { formatClock } from "./names";
import { isFinalForWait, type TaskStatus } from "./status";

// Every tool result is meant to be read aloud. Guidance for the assistant
// goes in a separate bracketed sentence so it can skip it.

export type TaskView = {
  name: string;
  sentName: string;
  projectDisplayName: string;
  status: TaskStatus;
  createdAt: number;
  sessionUrl?: string;
  error?: string;
  lastReportAt?: number;
  summary?: string;
  question?: string;
  prUrl?: string;
  branch?: string;
};

export type ProjectView = { displayName: string; isDefault: boolean };

export const NO_START_REPORT =
  "Claude hasn't checked in yet; open the session link to see why. " +
  "A common cause is the relay's domain missing from the routine environment's allowed domains.";

function sentence(text: string | undefined): string {
  if (!text) return "";
  const trimmed = text.trim();
  return ` ${/[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`}`;
}

function sessionLine(task: Pick<TaskView, "sessionUrl">): string {
  return task.sessionUrl ? `\nSession link: ${task.sessionUrl}` : "";
}

function waitHint(name: string): string {
  return `\n(For the assistant: call wait_for_task again with name "${name}" to keep waiting.)`;
}

export function sentText(task: TaskView): string {
  return (
    `Claude is on it in ${task.projectDisplayName}. I'll know the task's name in about a minute.` +
    sessionLine(task) +
    `\n(For the assistant: the task is called "${task.sentName}" until Claude names it; that name keeps working. ` +
    `If the user asked to be told when it is done, call wait_for_task with name "${task.sentName}" now, ` +
    "and call it again each time it says the task is still running, until it says done, failed, needs input or timed out. " +
    "Do not ask the user whether to keep waiting.)"
  );
}

export function fireErrorText(
  projectDisplayName: string,
  reason: "unauthorized" | "rate_limited" | "http_error" | "network_error" | "bad_response" | "key_error",
  status?: number,
): string {
  switch (reason) {
    case "unauthorized":
      return `The token for ${projectDisplayName} was rejected. Rotate it with projects:rotateToken.`;
    case "rate_limited":
      return "Rate limited by Anthropic; try again later.";
    case "http_error":
      return `Claude could not be started in ${projectDisplayName}. The routine API answered with status ${status ?? "unknown"}.`;
    case "network_error":
      return `Claude could not be started in ${projectDisplayName}. The routine API could not be reached.`;
    case "bad_response":
      return `Claude could not be started in ${projectDisplayName}. The routine API sent an answer I could not read.`;
    case "key_error":
      return (
        `The token for ${projectDisplayName} could not be decrypted. ` +
        "Check TOKEN_ENCRYPTION_KEY, or store the token again with projects:rotateToken."
      );
  }
}

/** The result once a task stops for wait purposes. */
export function finalText(task: TaskView, timeoutHours: number): string {
  const project = task.projectDisplayName;
  switch (task.status) {
    case "done": {
      const link = task.prUrl ? `\nPull request: ${task.prUrl}` : task.branch ? `\nBranch: ${task.branch}` : "";
      return `Claude finished ${task.name} in ${project}.${sentence(task.summary)}${link}`;
    }
    case "failed":
      if (task.error) return task.error;
      return `Claude could not finish ${task.name} in ${project}.${sentence(task.summary)}${sessionLine(task)}`;
    case "needs_input":
      return (
        `Claude needs your answer on ${task.name} in ${project}.${sentence(task.question)}` +
        `\n(For the assistant: read the question to the user. To answer it, call send_task with ` +
        `follow_up_of "${task.name}" and the user's answer as the request, for example "yes, go ahead".)`
      );
    case "timed_out":
      return (
        `${task.name} has sent no final report in ${hoursWord(timeoutHours)}, so I stopped waiting. ` +
        "Open the session link to check on it." +
        sessionLine(task)
      );
    default:
      return progressText(task, "UTC");
  }
}

export function hoursWord(hours: number): string {
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** Where a task stands while it is not final. */
export function progressText(task: TaskView, timeZone: string): string {
  switch (task.status) {
    case "sent":
      return `${task.name} is sent to ${task.projectDisplayName}. Claude has not checked in yet.`;
    case "no_start_report":
      return `${task.name}: ${NO_START_REPORT}${sessionLine(task)}`;
    default: {
      const last = task.lastReportAt ? ` Last report at ${formatClock(task.lastReportAt, timeZone)}.` : "";
      return `${task.name} is still running.${last}`;
    }
  }
}

export function stillWaitingText(task: TaskView, timeZone: string): string {
  return progressText(task, timeZone) + waitHint(task.name);
}

export function statusText(task: TaskView, timeZone: string, timeoutHours: number): string {
  return isFinalForWait(task.status) ? finalText(task, timeoutHours) : progressText(task, timeZone);
}

const STATUS_WORDS: Record<TaskStatus, string> = {
  sent: "sent, no report yet",
  running: "running",
  done: "done",
  failed: "failed",
  needs_input: "needs your input",
  no_start_report: "has not checked in",
  timed_out: "timed out",
};

export function listText(tasks: TaskView[], projectDisplayName?: string): string {
  if (tasks.length === 0) {
    return projectDisplayName ? `There are no ${projectDisplayName} tasks yet.` : "There are no tasks yet.";
  }
  return tasks.map((task) => `${task.name} (${task.projectDisplayName}): ${STATUS_WORDS[task.status]}.`).join("\n");
}

export function notFoundText(name: string, recent: TaskView[]): string {
  const known = recent
    .slice(0, 5)
    .map((t) => t.name)
    .join("; ");
  const hint = known ? ` Recent tasks: ${known}.` : " There are no tasks yet.";
  return `I could not find a task called "${name}".${hint} Use name "last" for the most recent task.`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

export const NO_PROJECTS_TEXT =
  "No projects are set up yet. Add one with npx convex run projects:add, as the agent-relay README describes.";

export function projectListText(projects: ProjectView[]): string {
  if (projects.length === 0) return NO_PROJECTS_TEXT;
  const names = projects.map((p) => (p.isDefault ? `${p.displayName} (default)` : p.displayName));
  return `Projects: ${names.join(", ")}.`;
}

export function ambiguousProjectText(spoken: string, candidates: ProjectView[]): string {
  return (
    `"${spoken}" could mean ${joinNames(candidates.map((p) => p.displayName))}. ` +
    "(For the assistant: ask the user which one, then call again with that project.)"
  );
}

export function unknownProjectText(spoken: string, known: ProjectView[]): string {
  return `There is no project called "${spoken}". ${projectListText(known)}`;
}

export function noDefaultText(known: ProjectView[]): string {
  return (
    `Which project? There is no default project. ${projectListText(known)} ` +
    "(For the assistant: ask the user which one, then call again with that project.)"
  );
}

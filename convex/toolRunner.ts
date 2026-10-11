import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { env, type ActionCtx } from "./_generated/server";
import { taskTimeoutHours, timeZoneOrUtc } from "./lib/config";
import { isFinalForWait } from "./lib/status";
import { finalText, listText, notFoundText, projectListText, statusText, stillWaitingText } from "./lib/speech";
import type { ToolName } from "./lib/toolDefinitions";
import { findTask, resolveProject, sendTask, type MatchableProjectRow, type ToolOutcome } from "./sendTask";

const RECENT_FOR_LIST = 5;
const POLL_MS = 2_000;

/** Swappable so tests can advance a fake clock instead of sleeping. */
export const clock = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function display() {
  return { timeZone: timeZoneOrUtc(env.DISPLAY_TIMEZONE), timeoutHours: taskTimeoutHours(env.TASK_TIMEOUT_HOURS) };
}

async function deliverFinal(ctx: ActionCtx, task: Doc<"tasks">): Promise<ToolOutcome> {
  await ctx.runMutation(internal.tasks.markDelivered, { taskId: task._id });
  return { text: finalText(task, display().timeoutHours), isError: false, taskId: task._id, finalDelivered: true };
}

// Reports arrive over HTTP at any time, so the wait re-reads the task every
// couple of seconds until it is final or the wait budget is spent.
async function waitForTask(ctx: ActionCtx, name: string, waitMs: number): Promise<ToolOutcome> {
  const found = await findTask(ctx, name);
  if (!found.task) return { text: notFoundText(name, found.recent), isError: true };
  let task: Doc<"tasks"> = found.task;
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (isFinalForWait(task.status)) return deliverFinal(ctx, task);
    const now = Date.now();
    if (now >= deadline) {
      return {
        text: stillWaitingText(task, display().timeZone),
        isError: false,
        taskId: task._id,
        finalDelivered: false,
      };
    }
    await clock.sleep(Math.min(POLL_MS, deadline - now));
    const fresh: Doc<"tasks"> | null = await ctx.runQuery(internal.tasks.get, { taskId: task._id });
    if (!fresh) return { text: notFoundText(name, []), isError: true };
    task = fresh;
  }
}

async function listTasks(ctx: ActionCtx, spokenProject: string): Promise<ToolOutcome> {
  if (!spokenProject.trim()) {
    const recent: Doc<"tasks">[] = await ctx.runQuery(internal.tasks.recent, { limit: RECENT_FOR_LIST });
    return { text: listText(recent), isError: false };
  }
  const resolved = await resolveProject(ctx, spokenProject);
  if ("text" in resolved) return { text: resolved.text, isError: true };
  const recent: Doc<"tasks">[] = await ctx.runQuery(internal.tasks.recent, {
    limit: RECENT_FOR_LIST,
    projectId: resolved.project._id,
  });
  return { text: listText(recent, resolved.project.displayName), isError: false };
}

export async function runTool(
  ctx: ActionCtx,
  tool: ToolName,
  args: Record<string, unknown>,
  waitMs: number,
): Promise<ToolOutcome> {
  switch (tool) {
    case "send_task":
      return sendTask(ctx, stringArg(args, "request"), stringArg(args, "project"), stringArg(args, "follow_up_of"));
    case "wait_for_task":
      return waitForTask(ctx, stringArg(args, "name"), waitMs);
    case "task_status": {
      const name = stringArg(args, "name");
      const { task, recent } = await findTask(ctx, name);
      if (!task) return { text: notFoundText(name, recent), isError: true };
      if (isFinalForWait(task.status)) return deliverFinal(ctx, task);
      const { timeZone, timeoutHours } = display();
      return { text: statusText(task, timeZone, timeoutHours), isError: false, taskId: task._id, finalDelivered: false };
    }
    case "list_tasks":
      return listTasks(ctx, stringArg(args, "project"));
    case "list_projects": {
      const projects: MatchableProjectRow[] = await ctx.runQuery(internal.projects.forMatching, {});
      return { text: projectListText(projects), isError: false };
    }
  }
}

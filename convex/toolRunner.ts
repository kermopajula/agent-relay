import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { matchTask } from "./lib/match";
import type { ToolName } from "./lib/toolDefinitions";
import {
  doneText,
  isFinished,
  listText,
  notFoundText,
  startedText,
  statusText,
  stillRunningText,
} from "./lib/speech";

export type ToolOutcome = {
  text: string;
  isError: boolean;
  taskId?: Id<"tasks">;
  finalDelivered?: boolean;
};

const RECENT_FOR_MATCHING = 50;
const RECENT_FOR_LIST = 5;

/** Swappable so tests can advance a fake clock instead of sleeping. */
export const clock = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

async function findTask(ctx: ActionCtx, name: string) {
  const recent: Doc<"tasks">[] = await ctx.runQuery(internal.tasks.recent, { limit: RECENT_FOR_MATCHING });
  return { task: matchTask(recent, name), recent };
}

async function deliverDone(ctx: ActionCtx, task: Doc<"tasks">): Promise<ToolOutcome> {
  await ctx.runMutation(internal.tasks.markDelivered, { taskId: task._id });
  return { text: doneText(task), isError: false, taskId: task._id, finalDelivered: true };
}

// The finish time is fixed at creation, so one sleep until min(due, deadline)
// is enough; there is nothing to gain from polling the database in between.
async function waitForTask(ctx: ActionCtx, name: string, waitMs: number): Promise<ToolOutcome> {
  const { task, recent } = await findTask(ctx, name);
  if (!task) return { text: notFoundText(name, recent), isError: true };
  const deadline = Date.now() + waitMs;
  for (;;) {
    const now = Date.now();
    if (isFinished(task, now)) return deliverDone(ctx, task);
    if (now >= deadline) {
      return { text: stillRunningText(task, now), isError: false, taskId: task._id, finalDelivered: false };
    }
    await clock.sleep(Math.min(task.dueAt, deadline) - now);
  }
}

export async function runTool(
  ctx: ActionCtx,
  tool: ToolName,
  args: Record<string, unknown>,
  waitMs: number,
): Promise<ToolOutcome> {
  switch (tool) {
    case "send_to_claude": {
      const text = stringArg(args, "task").trim();
      if (!text) return { text: "Please say what the task is.", isError: true };
      const task: Doc<"tasks"> = await ctx.runMutation(internal.tasks.create, { text });
      return { text: startedText(task), isError: false, taskId: task._id };
    }
    case "wait_for_task":
      return waitForTask(ctx, stringArg(args, "name"), waitMs);
    case "task_status": {
      const name = stringArg(args, "name");
      const { task, recent } = await findTask(ctx, name);
      if (!task) return { text: notFoundText(name, recent), isError: true };
      if (isFinished(task, Date.now())) return deliverDone(ctx, task);
      return { text: statusText(task, Date.now()), isError: false, taskId: task._id, finalDelivered: false };
    }
    case "list_tasks": {
      const recent: Doc<"tasks">[] = await ctx.runQuery(internal.tasks.recent, { limit: RECENT_FOR_LIST });
      return { text: listText(recent, Date.now()), isError: false };
    }
  }
}

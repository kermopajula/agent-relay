import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { taskTimeoutHours, timeZoneOrUtc } from "./lib/config";
import { constantTimeEqual } from "./lib/crypto";
import { dedupeName, provisionalName } from "./lib/names";
import { isClosed, isFinalForWait, type TaskStatus } from "./lib/status";

const NAME_SCAN = 200;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const START_REPORT_MINUTES = 15;

/** Names in use that start with `base`, by current name and by provisional name. */
export async function takenNames(ctx: MutationCtx, base: string, except?: Id<"tasks">): Promise<string[]> {
  const [byName, bySent] = await Promise.all([
    ctx.db
      .query("tasks")
      .withIndex("by_name", (q) => q.gte("name", base).lt("name", `${base}￿`))
      .take(NAME_SCAN),
    ctx.db
      .query("tasks")
      .withIndex("by_sentName", (q) => q.gte("sentName", base).lt("sentName", `${base}￿`))
      .take(NAME_SCAN),
  ]);
  return [...byName, ...bySent].filter((t) => t._id !== except).flatMap((t) => [t.name, t.sentName]);
}

export const create = internalMutation({
  args: {
    projectId: v.id("projects"),
    projectName: v.string(),
    projectDisplayName: v.string(),
    request: v.string(),
    followUpOf: v.optional(v.id("tasks")),
    reportSecretHash: v.string(),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    const base = provisionalName(args.projectDisplayName, createdAt, timeZoneOrUtc(env.DISPLAY_TIMEZONE));
    const name = dedupeName(base, await takenNames(ctx, base));
    const taskId = await ctx.db.insert("tasks", {
      ...args,
      name,
      sentName: name,
      nameReported: false,
      status: "sent",
      createdAt,
    });
    const task = await ctx.db.get("tasks", taskId);
    if (!task) throw new Error("Task vanished after insert");
    return task;
  },
});

export const markFired = internalMutation({
  args: { taskId: v.id("tasks"), sessionId: v.string(), sessionUrl: v.string() },
  handler: async (ctx, { taskId, sessionId, sessionUrl }) => {
    const firedAt = Date.now();
    await ctx.db.patch("tasks", taskId, { sessionId, sessionUrl, firedAt });
    await ctx.db.insert("taskEvents", { taskId, at: firedAt, status: "sent", source: "relay", note: "routine fired" });
    await ctx.scheduler.runAfter(START_REPORT_MINUTES * MINUTE_MS, internal.tasks.checkStarted, { taskId });
    const hours = taskTimeoutHours(env.TASK_TIMEOUT_HOURS);
    await ctx.scheduler.runAfter(hours * HOUR_MS, internal.tasks.checkFinished, { taskId, hours });
    return null;
  },
});

/** No report at all since the fire. Later reports are still accepted. */
export const checkStarted = internalMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get("tasks", taskId);
    if (!task || task.status !== "sent") return null;
    const now = Date.now();
    await ctx.db.patch("tasks", taskId, { status: "no_start_report" });
    await ctx.db.insert("taskEvents", {
      taskId,
      at: now,
      status: "no_start_report",
      source: "timer",
      note: `no report ${START_REPORT_MINUTES} minutes after the fire`,
    });
    return null;
  },
});

/** No final report in time. Final for wait_for_task, but a late report still overrides it. */
export const checkFinished = internalMutation({
  args: { taskId: v.id("tasks"), hours: v.number() },
  handler: async (ctx, { taskId, hours }) => {
    const task = await ctx.db.get("tasks", taskId);
    if (!task || isFinalForWait(task.status)) return null;
    const now = Date.now();
    await ctx.db.patch("tasks", taskId, { status: "timed_out", finalAt: now });
    await ctx.db.insert("taskEvents", {
      taskId,
      at: now,
      status: "timed_out",
      source: "timer",
      note: `no final report ${hours} hours after the fire`,
    });
    return null;
  },
});

/** A fire that failed is final at once, and send_task hands the error straight back. */
export const markFireFailed = internalMutation({
  args: { taskId: v.id("tasks"), error: v.string(), note: v.string() },
  handler: async (ctx, { taskId, error, note }) => {
    const now = Date.now();
    await ctx.db.patch("tasks", taskId, { status: "failed", error, finalAt: now, deliveredAt: now });
    await ctx.db.insert("taskEvents", { taskId, at: now, status: "failed", source: "relay", note });
    return null;
  },
});

/** Records the first time a final result was handed back to the assistant. */
export const markDelivered = internalMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get("tasks", taskId);
    if (!task || task.deliveredAt !== undefined) return null;
    await ctx.db.patch("tasks", taskId, { deliveredAt: Date.now() });
    return null;
  },
});

export const get = internalQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => ctx.db.get("tasks", taskId),
});

/** Newest first, optionally for one project. */
export const recent = internalQuery({
  args: { limit: v.number(), projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { limit, projectId }) => {
    if (projectId) {
      return ctx.db
        .query("tasks")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .order("desc")
        .take(limit);
    }
    return ctx.db.query("tasks").order("desc").take(limit);
  },
});

const reportValidator = v.object({
  status: v.union(v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("needs_input")),
  name: v.optional(v.string()),
  summary: v.optional(v.string()),
  question: v.optional(v.string()),
  prUrl: v.optional(v.string()),
  branch: v.optional(v.string()),
});

type ReportOutcome = {
  httpStatus: 200 | 400 | 404 | 409;
  message: string;
  taskId?: Id<"tasks">;
  name?: string;
  status?: TaskStatus;
};

/**
 * Applies one report from Claude. The secret check comes first, so a caller
 * without the secret learns nothing about the task, not even a 400.
 */
export const applyReport = internalMutation({
  args: {
    taskId: v.string(),
    secretHash: v.string(),
    report: v.optional(reportValidator),
    invalid: v.optional(v.string()),
  },
  handler: async (ctx, { taskId: rawId, secretHash, report, invalid }): Promise<ReportOutcome> => {
    const taskId = ctx.db.normalizeId("tasks", rawId);
    const task = taskId ? await ctx.db.get("tasks", taskId) : null;
    if (!task || !constantTimeEqual(task.reportSecretHash, secretHash)) {
      return { httpStatus: 404, message: "Not found" };
    }
    const known = { taskId: task._id, name: task.name, status: task.status };
    if (invalid !== undefined || !report) {
      return { ...known, httpStatus: 400, message: invalid ?? "Missing report" };
    }
    if (isClosed(task.status)) {
      return {
        ...known,
        httpStatus: 409,
        message: `This task already has the final status ${task.status}. A follow-up task carries any further work.`,
      };
    }

    const now = Date.now();
    let name = task.name;
    if (report.name && !task.nameReported) {
      name = dedupeName(report.name, await takenNames(ctx, report.name, task._id));
    }
    const final = report.status !== "running";
    await ctx.db.patch("tasks", task._id, {
      status: report.status,
      name,
      nameReported: task.nameReported || name !== task.name,
      lastReportAt: now,
      ...(report.summary !== undefined && { summary: report.summary }),
      ...(report.question !== undefined && { question: report.question }),
      ...(report.prUrl !== undefined && { prUrl: report.prUrl }),
      ...(report.branch !== undefined && { branch: report.branch }),
      // A late report can replace timed_out, so any earlier delivery no longer counts.
      ...(final && { finalAt: now, deliveredAt: undefined }),
    });
    await ctx.db.insert("taskEvents", {
      taskId: task._id,
      at: now,
      status: report.status,
      source: "report",
      note: name !== task.name ? `named "${name}"` : undefined,
    });
    return { taskId: task._id, name, status: report.status, httpStatus: 200, message: `Accepted ${report.status}.` };
  },
});

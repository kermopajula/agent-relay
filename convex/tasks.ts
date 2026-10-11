import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { chooseDuration } from "./lib/duration";

const MINUTE_MS = 60_000;

export const create = internalMutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const latest = await ctx.db.query("tasks").withIndex("by_number").order("desc").first();
    const number = (latest?.number ?? 0) + 1;
    const durationMinutes = chooseDuration(text, number);
    const createdAt = Date.now();
    const dueAt = createdAt + durationMinutes * MINUTE_MS;
    const taskId = await ctx.db.insert("tasks", {
      number,
      name: `Test task ${number} (${durationMinutes} min)`,
      text,
      durationMinutes,
      createdAt,
      dueAt,
      status: "running",
    });
    await ctx.scheduler.runAt(dueAt, internal.tasks.markDone, { taskId });
    const task = await ctx.db.get("tasks", taskId);
    if (!task) throw new Error("Task vanished after insert");
    return task;
  },
});

export const markDone = internalMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get("tasks", taskId);
    if (!task || task.status === "done") return null;
    await ctx.db.patch("tasks", taskId, { status: "done", doneAt: Date.now() });
    return null;
  },
});

/** Records the first time a final result was handed back to the client. */
export const markDelivered = internalMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get("tasks", taskId);
    if (!task || task.deliveredAt !== undefined) return null;
    await ctx.db.patch("tasks", taskId, { deliveredAt: Date.now() });
    return null;
  },
});

export const recent = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    return await ctx.db.query("tasks").withIndex("by_number").order("desc").take(limit);
  },
});

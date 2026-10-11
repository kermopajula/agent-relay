import { internalMutation, internalQuery } from "./_generated/server";
import schema from "./schema";

const callFields = schema.tables.calls.validator.fields;

export const record = internalMutation({
  args: callFields,
  handler: async (ctx, call) => {
    await ctx.db.insert("calls", call);
    return null;
  },
});

const LOG_CALLS = 500;
const SUMMARY_TASKS = 30;
const CALLS_PER_TASK = 200;

export const logData = internalQuery({
  args: {},
  handler: async (ctx) => {
    const calls = await ctx.db.query("calls").order("desc").take(LOG_CALLS);
    const tasks = await ctx.db.query("tasks").withIndex("by_number").order("desc").take(SUMMARY_TASKS);
    const taskCalls = await Promise.all(
      tasks.map((task) =>
        ctx.db
          .query("calls")
          .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
          .take(CALLS_PER_TASK),
      ),
    );
    return { calls, tasks: tasks.map((task, i) => ({ task, calls: taskCalls[i] ?? [] })) };
  },
});

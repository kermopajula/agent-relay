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
const EVENTS_PER_TASK = 50;

export const logData = internalQuery({
  args: {},
  handler: async (ctx) => {
    const calls = await ctx.db.query("calls").order("desc").take(LOG_CALLS);
    const tasks = await ctx.db.query("tasks").order("desc").take(SUMMARY_TASKS);
    const details = await Promise.all(
      tasks.map(async (task) => {
        const [taskCalls, events] = await Promise.all([
          ctx.db
            .query("calls")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .take(CALLS_PER_TASK),
          ctx.db
            .query("taskEvents")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .take(EVENTS_PER_TASK),
        ]);
        // The report secret's hash never leaves the database.
        const { reportSecretHash: _hash, ...safeTask } = task;
        return { task: safeTask, calls: taskCalls, events };
      }),
    );
    return { calls, tasks: details };
  },
});

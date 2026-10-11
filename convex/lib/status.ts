import { v } from "convex/values";

export const TASK_STATUSES = [
  "sent",
  "running",
  "done",
  "failed",
  "needs_input",
  "no_start_report",
  "timed_out",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const taskStatusValidator = v.union(
  v.literal("sent"),
  v.literal("running"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("needs_input"),
  v.literal("no_start_report"),
  v.literal("timed_out"),
);

/** Statuses a report can set. */
export const REPORT_STATUSES = ["running", "done", "failed", "needs_input"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Once a task has one of these, it takes no more reports (409). */
export function isClosed(status: TaskStatus): boolean {
  return status === "done" || status === "failed" || status === "needs_input";
}

/** wait_for_task stops on these. A timed-out task still accepts a late report. */
export function isFinalForWait(status: TaskStatus): boolean {
  return isClosed(status) || status === "timed_out";
}

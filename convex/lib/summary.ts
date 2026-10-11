import { truncate } from "./http";
import { isFinalForWait, type TaskStatus } from "./status";

export type SummaryTask = {
  name: string;
  projectName: string;
  request: string;
  status: TaskStatus;
  createdAt: number;
  sessionUrl?: string;
  finalAt?: number;
  deliveredAt?: number;
};

export type SummaryEvent = {
  at: number;
  status: TaskStatus;
  source: "relay" | "report" | "timer";
  note?: string;
};

export type SummaryCall = {
  at: number;
  durationMs: number;
  httpMethod: string;
  httpStatus: number;
  rpcMethod?: string;
  tool?: string;
  args?: string;
  responseSummary: string;
  protocolVersion?: string;
  clientName?: string;
  clientVersion?: string;
  userAgent?: string;
  finalDelivered?: boolean;
  auth?: "bearer" | "path";
  endpoint?: "mcp" | "report";
};

export function formatTime(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function formatSpan(ms: number): string {
  const total = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

function isReport(call: SummaryCall): boolean {
  return call.endpoint === "report";
}

function deliveryLine(task: SummaryTask, assistantCalls: SummaryCall[], time: (ms: number) => string): string {
  if (task.deliveredAt !== undefined) {
    return `  Delivered to assistant: yes, at ${time(task.deliveredAt)}, ${formatSpan(task.deliveredAt - task.createdAt)} after sending.`;
  }
  if (!isFinalForWait(task.status)) return "  Delivered to assistant: not yet, the task is not finished.";
  const last = assistantCalls[assistantCalls.length - 1];
  const lastEnd = last ? last.at + last.durationMs : task.createdAt;
  const finalAt = task.finalAt ?? lastEnd;
  return (
    `  Delivered to assistant: NO. The assistant stopped checking ${formatSpan(lastEnd - task.createdAt)} after sending, ` +
    `${formatSpan(finalAt - lastEnd)} before the final status.`
  );
}

/** `events` and `calls` must be oldest first and belong to this task. */
export function summarizeTask(
  task: SummaryTask,
  events: SummaryEvent[],
  calls: SummaryCall[],
  tz: string,
): string {
  const time = (ms: number) => formatTime(ms, tz);
  const lines = [
    `${task.name} [${task.projectName}]: ${task.status}, sent ${time(task.createdAt)}.`,
    `  Request: "${truncate(task.request.replace(/\s+/g, " "), 160)}"`,
    `  Session: ${task.sessionUrl ?? "none"}`,
    "  Status history:",
    ...events.map((e) => `    ${time(e.at)}  ${e.status.padEnd(15)} ${e.source}${e.note ? `: ${e.note}` : ""}`),
  ];

  const reports = calls.filter(isReport);
  lines.push(`  Reports: ${reports.length}`);
  for (const report of reports) {
    lines.push(`    ${time(report.at)}  HTTP ${report.httpStatus}  ${report.args ?? ""}  ${report.responseSummary}`);
  }

  const assistantCalls = calls.filter((c) => !isReport(c));
  const waits = assistantCalls.filter((c) => c.tool === "wait_for_task").length;
  const statuses = assistantCalls.filter((c) => c.tool === "task_status").length;
  lines.push(`  Assistant calls: ${assistantCalls.length} (wait_for_task ${waits}, task_status ${statuses})`);
  let previousEnd = task.createdAt;
  for (const call of assistantCalls) {
    const label = (call.tool ?? call.rpcMethod ?? call.httpMethod).padEnd(14);
    lines.push(
      `    ${time(call.at)}  ${label} gap ${formatSpan(call.at - previousEnd).padStart(7)}  held ${formatSpan(call.durationMs).padStart(7)}  ${call.responseSummary.replace(/\n/g, " ")}`,
    );
    previousEnd = Math.max(previousEnd, call.at + call.durationMs);
  }
  lines.push(deliveryLine(task, assistantCalls, time));
  return lines.join("\n");
}

/** One line per user agent, with any client name and protocol it reported. */
export function summarizeClients(calls: SummaryCall[]): string {
  const byAgent = new Map<string, { clients: Set<string>; protocols: Set<string>; auths: Set<string> }>();
  for (const call of calls) {
    if (isReport(call)) continue;
    const agent = call.userAgent ?? "no user agent";
    const entry = byAgent.get(agent) ?? { clients: new Set(), protocols: new Set(), auths: new Set() };
    if (call.auth) entry.auths.add(call.auth);
    if (call.clientName) entry.clients.add(`${call.clientName} ${call.clientVersion ?? ""}`.trim());
    if (call.protocolVersion) entry.protocols.add(call.protocolVersion);
    byAgent.set(agent, entry);
  }
  if (byAgent.size === 0) return "Clients seen: none yet.";
  const lines = [...byAgent].map(([agent, { clients, protocols, auths }]) => {
    const client = clients.size ? `client ${[...clients].join(", ")}` : "no clientInfo";
    const protocol = protocols.size ? `, protocol ${[...protocols].join(", ")}` : "";
    const auth = auths.size ? `, auth ${[...auths].sort().join(", ")}` : "";
    return `  user agent "${agent}": ${client}${protocol}${auth}`;
  });
  return ["Clients seen:", ...lines].join("\n");
}

export function buildSummary(
  tasks: { task: SummaryTask; events: SummaryEvent[]; calls: SummaryCall[] }[],
  recentCalls: SummaryCall[],
  now: number,
  tz: string,
): string {
  const header = [
    `Generated ${formatTime(now, tz)} (${tz}). ${recentCalls.length} recent requests, ${tasks.length} recent tasks.`,
    summarizeClients(recentCalls),
  ];
  const body = tasks.length
    ? tasks.map(({ task, events, calls }) => summarizeTask(task, events, calls, tz))
    : ["No tasks yet."];
  return [...header, "", ...body].join("\n\n").replace(/\n{3,}/g, "\n\n");
}

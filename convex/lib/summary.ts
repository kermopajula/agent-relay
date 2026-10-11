export type SummaryTask = {
  name: string;
  text: string;
  createdAt: number;
  dueAt: number;
  deliveredAt?: number;
};

export type SummaryCall = {
  at: number;
  durationMs: number;
  httpMethod: string;
  rpcMethod?: string;
  tool?: string;
  responseSummary: string;
  protocolVersion?: string;
  clientName?: string;
  clientVersion?: string;
  userAgent?: string;
  finalDelivered?: boolean;
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

function relative(ms: number, reference: string): string {
  return ms >= 0 ? `${formatSpan(ms)} after ${reference}` : `${formatSpan(ms)} before ${reference}`;
}

/** `calls` must be oldest first and belong to this task. */
export function summarizeTask(task: SummaryTask, calls: SummaryCall[], now: number, tz: string): string {
  const time = (ms: number) => formatTime(ms, tz);
  const finished = now >= task.dueAt;
  const lines = [
    `${task.name}: created ${time(task.createdAt)}, finishes ${time(task.dueAt)}, ${finished ? "done" : "still running"}.`,
    `  Task text: "${task.text}"`,
  ];

  const checks = calls.filter((c) => c.tool === "wait_for_task" || c.tool === "task_status");
  const waits = checks.filter((c) => c.tool === "wait_for_task").length;
  lines.push(`  Checks: ${checks.length} (wait_for_task ${waits}, task_status ${checks.length - waits})`);

  let previousEnd = task.createdAt;
  for (const call of calls) {
    const gap = call.at - previousEnd;
    const label = (call.tool ?? call.rpcMethod ?? call.httpMethod).padEnd(14);
    lines.push(
      `  ${time(call.at)}  ${label} gap ${formatSpan(gap).padStart(7)}  held ${formatSpan(call.durationMs).padStart(7)}  ${call.responseSummary}`,
    );
    previousEnd = Math.max(previousEnd, call.at + call.durationMs);
  }

  const last = calls[calls.length - 1];
  if (last) {
    lines.push(`  Last call: ${time(last.at)} (${relative(last.at - task.dueAt, "the finish time")}).`);
  }

  if (task.deliveredAt !== undefined) {
    lines.push(
      `  Final result delivered to Grok: yes, at ${time(task.deliveredAt)}, ${formatSpan(task.deliveredAt - task.createdAt)} after creation.`,
    );
  } else if (!finished) {
    lines.push("  Final result delivered to Grok: not yet, the task is still running.");
  } else {
    const lastEnd = last ? last.at + last.durationMs : task.createdAt;
    lines.push(
      `  Final result delivered to Grok: NO. The client stopped checking ${formatSpan(lastEnd - task.createdAt)} after creation, ` +
        `${formatSpan(task.dueAt - lastEnd)} before the task finished.`,
    );
  }
  return lines.join("\n");
}

/** One line per user agent, with any client name and protocol it reported. */
export function summarizeClients(calls: SummaryCall[]): string {
  const byAgent = new Map<string, { clients: Set<string>; protocols: Set<string> }>();
  for (const call of calls) {
    const agent = call.userAgent ?? "no user agent";
    const entry = byAgent.get(agent) ?? { clients: new Set(), protocols: new Set() };
    if (call.clientName) entry.clients.add(`${call.clientName} ${call.clientVersion ?? ""}`.trim());
    if (call.protocolVersion) entry.protocols.add(call.protocolVersion);
    byAgent.set(agent, entry);
  }
  if (byAgent.size === 0) return "Clients seen: none yet.";
  const lines = [...byAgent].map(([agent, { clients, protocols }]) => {
    const client = clients.size ? `client ${[...clients].join(", ")}` : "no clientInfo";
    const protocol = protocols.size ? `, protocol ${[...protocols].join(", ")}` : "";
    return `  user agent "${agent}": ${client}${protocol}`;
  });
  return ["Clients seen:", ...lines].join("\n");
}

export function buildSummary(
  tasks: { task: SummaryTask; calls: SummaryCall[] }[],
  recentCalls: SummaryCall[],
  now: number,
  tz: string,
): string {
  const header = [
    `Generated ${formatTime(now, tz)} (${tz}). ${recentCalls.length} recent requests, ${tasks.length} recent tasks.`,
    summarizeClients(recentCalls),
  ];
  const body = tasks.length
    ? tasks.map(({ task, calls }) => summarizeTask(task, calls, now, tz))
    : ["No tasks yet."];
  return [...header, "", ...body].join("\n\n").replace(/\n{3,}/g, "\n\n");
}

import { REPORT_STATUSES, type ReportStatus } from "./status";

export const MAX_NAME = 60;
export const MAX_SUMMARY = 600;
const MAX_URL = 500;
const MAX_BRANCH = 200;
const FIELDS = ["status", "name", "summary", "question", "pr_url", "branch"];

export type Report = {
  status: ReportStatus;
  name?: string;
  summary?: string;
  question?: string;
  prUrl?: string;
  branch?: string;
};

type Parsed = { ok: true; report: Report } | { ok: false; message: string };

function optionalText(body: Record<string, unknown>, field: string, max: number): string | undefined | Error {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return new Error(`${field} must be a string.`);
  const text = value.trim();
  if (text === "") return undefined;
  if (text.length > max) return new Error(`${field} must be at most ${max} characters; it has ${text.length}.`);
  return text;
}

/** Checks a report body strictly. Empty strings and null count as missing. */
export function parseReport(body: unknown): Parsed {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "The body must be a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !FIELDS.includes(key));
  if (unknown.length > 0) {
    return { ok: false, message: `Unknown field: ${unknown.join(", ")}. Allowed fields: ${FIELDS.join(", ")}.` };
  }
  const status = record.status;
  if (typeof status !== "string" || !(REPORT_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, message: `status must be one of ${REPORT_STATUSES.map((s) => `"${s}"`).join(", ")}.` };
  }
  const name = optionalText(record, "name", MAX_NAME);
  const summary = optionalText(record, "summary", MAX_SUMMARY);
  const question = optionalText(record, "question", MAX_SUMMARY);
  const prUrl = optionalText(record, "pr_url", MAX_URL);
  const branch = optionalText(record, "branch", MAX_BRANCH);
  for (const value of [name, summary, question, prUrl, branch]) {
    if (value instanceof Error) return { ok: false, message: value.message };
  }
  if (typeof prUrl === "string" && !/^https:\/\/\S+$/.test(prUrl)) {
    return { ok: false, message: "pr_url must be an https URL." };
  }
  if (status === "needs_input" && question === undefined) {
    return { ok: false, message: "A needs_input report must include question." };
  }
  return {
    ok: true,
    report: {
      status: status as ReportStatus,
      name: name as string | undefined,
      summary: summary as string | undefined,
      question: question as string | undefined,
      prUrl: prUrl as string | undefined,
      branch: branch as string | undefined,
    },
  };
}

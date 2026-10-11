import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env, type ActionCtx } from "./_generated/server";
import { decryptToken, KeyError, randomSecret, sha256Hex } from "./lib/crypto";
import { matchProject, matchTask } from "./lib/match";
import { buildPayload, type FollowUpContext } from "./lib/payload";
import { fireRoutine } from "./lib/routineApi";
import {
  ambiguousProjectText,
  fireErrorText,
  NO_PROJECTS_TEXT,
  noDefaultText,
  notFoundText,
  sentText,
  unknownProjectText,
} from "./lib/speech";

export type ToolOutcome = {
  text: string;
  isError: boolean;
  taskId?: Id<"tasks">;
  finalDelivered?: boolean;
};

export type MatchableProjectRow = {
  _id: Id<"projects">;
  name: string;
  displayName: string;
  aliases: string[];
  isDefault: boolean;
};

export const RECENT_FOR_MATCHING = 50;
const MAX_REQUEST = 4000;

export async function recentTasks(ctx: ActionCtx, limit = RECENT_FOR_MATCHING): Promise<Doc<"tasks">[]> {
  return ctx.runQuery(internal.tasks.recent, { limit });
}

export async function findTask(ctx: ActionCtx, name: string) {
  const recent = await recentTasks(ctx);
  return { task: matchTask(recent, name), recent };
}

/** Resolves a spoken project name, or returns the text that asks the user. */
export async function resolveProject(
  ctx: ActionCtx,
  spoken: string,
  known?: MatchableProjectRow[],
): Promise<{ project: MatchableProjectRow } | { text: string }> {
  const projects: MatchableProjectRow[] = known ?? (await ctx.runQuery(internal.projects.forMatching, {}));
  const result = matchProject(projects, spoken);
  switch (result.kind) {
    case "match":
      return { project: result.project };
    case "ambiguous":
      return { text: ambiguousProjectText(spoken, result.candidates) };
    case "unknown":
      return { text: unknownProjectText(spoken, result.known) };
    case "no_projects":
      return { text: NO_PROJECTS_TEXT };
    case "no_default":
      return { text: noDefaultText(result.known) };
  }
}

function followUpContext(task: Doc<"tasks">): FollowUpContext {
  return {
    request: task.request,
    name: task.name,
    status: task.status,
    summary: task.summary,
    question: task.question,
    prUrl: task.prUrl,
    branch: task.branch,
    sessionUrl: task.sessionUrl,
  };
}

function reportUrl(taskId: string): string {
  const site = (env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
  if (!site) throw new Error("CONVEX_SITE_URL is not set");
  return `${site}/report/${taskId}`;
}

export async function sendTask(
  ctx: ActionCtx,
  rawRequest: string,
  spokenProject: string,
  followUpOf: string,
): Promise<ToolOutcome> {
  const request = rawRequest.trim();
  if (!request) return { text: "Please say what the request is.", isError: true };
  if (request.length > MAX_REQUEST) {
    return { text: `The request is too long; keep it under ${MAX_REQUEST} characters.`, isError: true };
  }

  let earlier: Doc<"tasks"> | null = null;
  if (followUpOf.trim()) {
    const found = await findTask(ctx, followUpOf);
    if (!found.task) return { text: notFoundText(followUpOf, found.recent), isError: true };
    earlier = found.task;
  }

  // A follow-up goes to the same project unless the user names another one.
  let project: MatchableProjectRow;
  const projects: MatchableProjectRow[] = await ctx.runQuery(internal.projects.forMatching, {});
  const sameProject = earlier && !spokenProject.trim() ? projects.find((p) => p._id === earlier.projectId) : undefined;
  if (sameProject) {
    project = sameProject;
  } else {
    const resolved = await resolveProject(ctx, spokenProject, projects);
    if ("text" in resolved) return { text: resolved.text, isError: true };
    project = resolved.project;
  }

  const reportSecret = randomSecret();
  const task: Doc<"tasks"> = await ctx.runMutation(internal.tasks.create, {
    projectId: project._id,
    projectName: project.name,
    projectDisplayName: project.displayName,
    request,
    followUpOf: earlier?._id,
    reportSecretHash: await sha256Hex(reportSecret),
  });

  const fail = async (reason: Parameters<typeof fireErrorText>[1], status?: number): Promise<ToolOutcome> => {
    const text = fireErrorText(project.displayName, reason, status);
    const note = status === undefined ? `fire failed: ${reason}` : `fire failed: ${reason} (HTTP ${status})`;
    await ctx.runMutation(internal.tasks.markFireFailed, { taskId: task._id, error: text, note });
    return { text, isError: true, taskId: task._id, finalDelivered: true };
  };

  const config = await ctx.runQuery(internal.projects.fireConfig, { projectId: project._id });
  if (!config) return fail("http_error");
  let token: string;
  try {
    token = await decryptToken(config.encryptedToken, env.TOKEN_ENCRYPTION_KEY);
  } catch (error) {
    if (error instanceof KeyError) return fail("key_error");
    throw error;
  }

  const text = buildPayload({
    request,
    projectDisplayName: project.displayName,
    taskId: task._id,
    reportUrl: reportUrl(task._id),
    reportSecret,
    followUp: earlier ? followUpContext(earlier) : undefined,
  });
  const fired = await fireRoutine(config.fireUrl, token, text);
  if (!fired.ok) return fail(fired.reason, fired.status);

  await ctx.runMutation(internal.tasks.markFired, {
    taskId: task._id,
    sessionId: fired.sessionId,
    sessionUrl: fired.sessionUrl,
  });
  return { text: sentText({ ...task, sessionUrl: fired.sessionUrl }), isError: false, taskId: task._id };
}

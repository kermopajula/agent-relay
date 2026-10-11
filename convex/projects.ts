import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { env, internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { encryptToken, KeyError } from "./lib/crypto";
import { displayNameFromSlug, isSlug, MAX_SLUG_LENGTH } from "./lib/names";
import { parseFireUrl } from "./lib/routineApi";

// Every function here is internal. The owner manages projects with
// `npx convex run projects:<name> '<json>' --prod`, which uses the deploy key.

const MAX_PROJECTS = 50;
const MAX_ALIASES = 10;
const MAX_TEXT = 60;

export type ProjectView = {
  name: string;
  displayName: string;
  aliases: string[];
  fireUrl: string;
  isDefault: boolean;
  createdAt: number;
  tokenUpdatedAt: number;
};

const projectView = v.object({
  name: v.string(),
  displayName: v.string(),
  aliases: v.array(v.string()),
  fireUrl: v.string(),
  isDefault: v.boolean(),
  createdAt: v.number(),
  tokenUpdatedAt: v.number(),
});

/** The public shape of a project: everything except the token. */
export function toView(project: Doc<"projects">): ProjectView {
  return {
    name: project.name,
    displayName: project.displayName,
    aliases: project.aliases,
    fireUrl: project.fireUrl,
    isDefault: project.isDefault,
    createdAt: project.createdAt,
    tokenUpdatedAt: project.tokenUpdatedAt,
  };
}

async function byName(ctx: QueryCtx, name: string) {
  return ctx.db
    .query("projects")
    .withIndex("by_name", (q) => q.eq("name", name))
    .unique();
}

async function requireProject(ctx: QueryCtx, name: string) {
  const project = await byName(ctx, name);
  if (!project) throw new ConvexError(`No project named "${name}". Run projects:list to see the names.`);
  return project;
}

async function clearDefault(ctx: MutationCtx) {
  const projects = await ctx.db.query("projects").take(MAX_PROJECTS);
  for (const project of projects) {
    if (project.isDefault) await ctx.db.patch("projects", project._id, { isDefault: false });
  }
}

function cleanText(value: string, field: string): string {
  const text = value.trim();
  if (text === "" || text.length > MAX_TEXT) throw new ConvexError(`${field} must be 1 to ${MAX_TEXT} characters.`);
  return text;
}

function checkFireUrl(fireUrl: string): string {
  const parsed = parseFireUrl(fireUrl);
  if (!parsed.ok) throw new ConvexError(parsed.message);
  return fireUrl.trim();
}

function checkToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length < 20 || /\s/.test(trimmed)) {
    throw new ConvexError("token must be the routine's API token, shown once when you add the API trigger.");
  }
  return trimmed;
}

async function seal(token: string): Promise<string> {
  try {
    return await encryptToken(token, env.TOKEN_ENCRYPTION_KEY);
  } catch (error) {
    if (error instanceof KeyError) throw new ConvexError(error.message);
    throw error;
  }
}

export const add = internalAction({
  args: {
    name: v.string(),
    displayName: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    fireUrl: v.string(),
    token: v.string(),
    makeDefault: v.optional(v.boolean()),
  },
  returns: projectView,
  handler: async (ctx, args): Promise<ProjectView> => {
    const name = args.name.trim();
    if (!isSlug(name)) {
      throw new ConvexError(
        `name must be a lowercase slug of up to ${MAX_SLUG_LENGTH} characters, such as "begin-bugs".`,
      );
    }
    const displayName = cleanText(args.displayName ?? displayNameFromSlug(name), "displayName");
    const aliases = (args.aliases ?? []).map((alias) => cleanText(alias, "Each alias"));
    if (aliases.length > MAX_ALIASES) throw new ConvexError(`At most ${MAX_ALIASES} aliases.`);
    const fireUrl = checkFireUrl(args.fireUrl);
    const encryptedToken = await seal(checkToken(args.token));
    return await ctx.runMutation(internal.projects.insert, {
      name,
      displayName,
      aliases,
      fireUrl,
      encryptedToken,
      makeDefault: args.makeDefault,
    });
  },
});

export const insert = internalMutation({
  args: {
    name: v.string(),
    displayName: v.string(),
    aliases: v.array(v.string()),
    fireUrl: v.string(),
    encryptedToken: v.string(),
    makeDefault: v.optional(v.boolean()),
  },
  returns: projectView,
  handler: async (ctx, { makeDefault, ...fields }) => {
    if (await byName(ctx, fields.name)) {
      throw new ConvexError(`A project named "${fields.name}" exists. Use projects:rotateToken to change its token.`);
    }
    const existing = await ctx.db.query("projects").take(MAX_PROJECTS);
    if (existing.length >= MAX_PROJECTS) throw new ConvexError(`At most ${MAX_PROJECTS} projects.`);
    // The first project becomes the default unless the caller says otherwise.
    const isDefault = makeDefault ?? !existing.some((p) => p.isDefault);
    if (isDefault) await clearDefault(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("projects", { ...fields, isDefault, createdAt: now, tokenUpdatedAt: now });
    const project = await ctx.db.get("projects", id);
    if (!project) throw new Error("Project vanished after insert");
    return toView(project);
  },
});

export const list = internalQuery({
  args: {},
  returns: v.array(projectView),
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").withIndex("by_name").take(MAX_PROJECTS);
    return projects.map(toView);
  },
});

export const remove = internalMutation({
  args: { name: v.string() },
  returns: v.string(),
  handler: async (ctx, { name }) => {
    const project = await requireProject(ctx, name);
    await ctx.db.delete("projects", project._id);
    return project.isDefault
      ? `Removed ${name}. There is no default project now; set one with projects:setDefault.`
      : `Removed ${name}.`;
  },
});

export const setDefault = internalMutation({
  args: { name: v.string() },
  returns: projectView,
  handler: async (ctx, { name }) => {
    const project = await requireProject(ctx, name);
    await clearDefault(ctx);
    await ctx.db.patch("projects", project._id, { isDefault: true });
    return toView({ ...project, isDefault: true });
  },
});

/** Changes the display name, aliases or fire URL. The token stays as it is. */
export const update = internalMutation({
  args: {
    name: v.string(),
    displayName: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    fireUrl: v.optional(v.string()),
  },
  returns: projectView,
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.name);
    const changes: Partial<Pick<Doc<"projects">, "displayName" | "aliases" | "fireUrl">> = {};
    if (args.displayName !== undefined) changes.displayName = cleanText(args.displayName, "displayName");
    if (args.aliases !== undefined) {
      const aliases = args.aliases.map((alias) => cleanText(alias, "Each alias"));
      if (aliases.length > MAX_ALIASES) throw new ConvexError(`At most ${MAX_ALIASES} aliases.`);
      changes.aliases = aliases;
    }
    if (args.fireUrl !== undefined) changes.fireUrl = checkFireUrl(args.fireUrl);
    await ctx.db.patch("projects", project._id, changes);
    return toView({ ...project, ...changes });
  },
});

export const rotateToken = internalAction({
  args: { name: v.string(), token: v.string() },
  returns: projectView,
  handler: async (ctx, { name, token }): Promise<ProjectView> => {
    const encryptedToken = await seal(checkToken(token));
    return await ctx.runMutation(internal.projects.storeToken, { name, encryptedToken });
  },
});

export const storeToken = internalMutation({
  args: { name: v.string(), encryptedToken: v.string() },
  returns: projectView,
  handler: async (ctx, { name, encryptedToken }) => {
    const project = await requireProject(ctx, name);
    const tokenUpdatedAt = Date.now();
    await ctx.db.patch("projects", project._id, { encryptedToken, tokenUpdatedAt });
    return toView({ ...project, tokenUpdatedAt });
  },
});

/** Projects without tokens, for matching spoken names. */
export const forMatching = internalQuery({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").withIndex("by_name").take(MAX_PROJECTS);
    return projects.map((p) => ({ _id: p._id, ...toView(p) }));
  },
});

/** The fire URL and the still encrypted token, for the action that fires the routine. */
export const fireConfig = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get("projects", projectId);
    return project ? { fireUrl: project.fireUrl, encryptedToken: project.encryptedToken } : null;
  },
});

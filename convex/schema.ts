import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { taskStatusValidator } from "./lib/status";

export default defineSchema({
  projects: defineTable({
    name: v.string(),
    displayName: v.string(),
    aliases: v.array(v.string()),
    fireUrl: v.string(),
    // AES-GCM ciphertext; see lib/crypto.ts. The plain token is never stored.
    encryptedToken: v.string(),
    isDefault: v.boolean(),
    createdAt: v.number(),
    tokenUpdatedAt: v.number(),
  }).index("by_name", ["name"]),

  tasks: defineTable({
    projectId: v.id("projects"),
    // Copied at send time so the log still reads well after a project is removed.
    projectName: v.string(),
    projectDisplayName: v.string(),
    request: v.string(),
    followUpOf: v.optional(v.id("tasks")),
    name: v.string(),
    // The provisional name; it keeps matching after Claude renames the task.
    sentName: v.string(),
    nameReported: v.boolean(),
    status: taskStatusValidator,
    createdAt: v.number(),
    // SHA-256 of the per-task report secret. The secret itself is never stored.
    reportSecretHash: v.string(),
    sessionId: v.optional(v.string()),
    sessionUrl: v.optional(v.string()),
    firedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    lastReportAt: v.optional(v.number()),
    finalAt: v.optional(v.number()),
    summary: v.optional(v.string()),
    question: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    branch: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_name", ["name"])
    .index("by_sentName", ["sentName"])
    .index("by_projectId", ["projectId"]),

  taskEvents: defineTable({
    taskId: v.id("tasks"),
    at: v.number(),
    status: taskStatusValidator,
    source: v.union(v.literal("relay"), v.literal("report"), v.literal("timer")),
    note: v.optional(v.string()),
  }).index("by_taskId", ["taskId"]),

  calls: defineTable({
    at: v.number(),
    durationMs: v.number(),
    httpMethod: v.string(),
    httpStatus: v.number(),
    rpcMethod: v.optional(v.string()),
    rpcId: v.optional(v.string()),
    tool: v.optional(v.string()),
    // Stored as JSON text: client-supplied keys may not be valid Convex field names.
    args: v.optional(v.string()),
    responseSummary: v.string(),
    era: v.union(v.literal("legacy"), v.literal("modern"), v.literal("none")),
    protocolVersion: v.optional(v.string()),
    clientName: v.optional(v.string()),
    clientVersion: v.optional(v.string()),
    capabilities: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    origin: v.optional(v.string()),
    taskId: v.optional(v.id("tasks")),
    finalDelivered: v.optional(v.boolean()),
    auth: v.optional(v.union(v.literal("bearer"), v.literal("path"))),
    // Missing on MCP calls logged before reports existed.
    endpoint: v.optional(v.union(v.literal("mcp"), v.literal("report"))),
  }).index("by_taskId", ["taskId"]),
});

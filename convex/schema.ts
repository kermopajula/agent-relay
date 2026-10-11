import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tasks: defineTable({
    number: v.number(),
    name: v.string(),
    text: v.string(),
    durationMinutes: v.number(),
    createdAt: v.number(),
    dueAt: v.number(),
    status: v.union(v.literal("running"), v.literal("done")),
    doneAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
  }).index("by_number", ["number"]),

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
  }).index("by_taskId", ["taskId"]),
});

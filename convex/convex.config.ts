import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    CONNECTOR_SECRET: v.optional(v.string()),
    WAIT_SECONDS: v.optional(v.string()),
    ALLOWED_ORIGINS: v.optional(v.string()),
  },
});

export default app;

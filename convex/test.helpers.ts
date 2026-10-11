/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { vi } from "vitest";
import { internal } from "./_generated/api";
import { fireUrl, type FakeRoutineApi } from "./fakeRoutineApi.helpers";
import schema from "./schema";

export const modules = import.meta.glob("./**/*.ts");
export const SECRET = "test-secret-0123456789abcdef";
export const MCP = `/mcp/${SECRET}`;
// 32 bytes of 0x01, base64. Tests only.
export const ENCRYPTION_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
export const SITE_URL = "https://happy-otter-123.convex.site";

export type TestConvex = ReturnType<typeof convexTest>;

export function setup(env: Record<string, string> = {}): TestConvex {
  vi.stubEnv("CONNECTOR_SECRET", SECRET);
  vi.stubEnv("WAIT_SECONDS", "50");
  vi.stubEnv("ALLOWED_ORIGINS", "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", ENCRYPTION_KEY);
  vi.stubEnv("CONVEX_SITE_URL", SITE_URL);
  vi.stubEnv("TASK_TIMEOUT_HOURS", "");
  vi.stubEnv("DISPLAY_TIMEZONE", "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return convexTest(schema, modules);
}

let nextId = 1;

export function legacyRequest(method: string, params?: Record<string, unknown>, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": "relay-test/1.0",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }),
  };
}

export const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "ModernClient", version: "2.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

export function modernRequest(method: string, params: Record<string, unknown> = {}, headers?: Record<string, string>) {
  const name: Record<string, string> = typeof params.name === "string" ? { "Mcp-Name": params.name } : {};
  return legacyRequest(
    method,
    { ...params, _meta: MODERN_META },
    headers ?? { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method, ...name },
  );
}

export async function post(t: TestConvex, init: RequestInit, path = MCP) {
  const res = await t.fetch(path, init);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

/** Calls a tool over the legacy transport and returns its spoken text. */
export async function callTool(t: TestConvex, name: string, args: Record<string, unknown> = {}) {
  const { status, body } = await post(t, legacyRequest("tools/call", { name, arguments: args }));
  if (status !== 200 || !body.result) throw new Error(`tools/call ${name} failed: ${JSON.stringify(body)}`);
  return { text: body.result.content[0].text as string, isError: body.result.isError as boolean };
}

export function tokenFor(name: string): string {
  return `sk-ant-oat01-${name}-token-0123456789`;
}

export function routineIdFor(name: string): string {
  return `trig_01${name.replace(/[^a-z0-9]/gi, "").toUpperCase()}`;
}

/** Adds a project through projects:add and teaches the fake API its token. */
export async function addProject(
  t: TestConvex,
  api: FakeRoutineApi,
  name: string,
  extra: { displayName?: string; aliases?: string[]; makeDefault?: boolean } = {},
) {
  const routineId = routineIdFor(name);
  api.allow(routineId, tokenFor(name));
  return t.action(internal.projects.add, { name, fireUrl: fireUrl(routineId), token: tokenFor(name), ...extra });
}

export async function allTasks(t: TestConvex) {
  return t.run((ctx) => ctx.db.query("tasks").collect());
}

/** Pulls the report secret out of a fire payload. */
export function secretFrom(text: string): string {
  const secret = /^Report secret: (\S+)$/m.exec(text)?.[1];
  if (!secret) throw new Error("No report secret in the payload");
  return secret;
}

export function reportUrlFrom(text: string): string {
  const url = /^Report URL: (\S+)$/m.exec(text)?.[1];
  if (!url) throw new Error("No report URL in the payload");
  return url;
}

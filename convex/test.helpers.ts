/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { vi } from "vitest";
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
      "User-Agent": "spike-test/1.0",
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

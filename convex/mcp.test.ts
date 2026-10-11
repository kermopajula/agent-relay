import { afterEach, describe, expect, test, vi } from "vitest";
import { MCP, SECRET, legacyRequest, modernRequest, post, setup } from "./test.helpers";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("secret in the path", () => {
  test("the right secret reaches the MCP server", async () => {
    const t = setup();
    const { status, body } = await post(t, legacyRequest("ping"));
    expect(status).toBe(200);
    expect(body.result).toEqual({});
  });

  test("a wrong, missing or extended secret answers 404 like an unknown page", async () => {
    const t = setup();
    for (const path of ["/mcp/wrong-secret-0123456789", "/mcp/", `/mcp/${SECRET}/extra`, `/mcp/${SECRET}x`]) {
      const res = await t.fetch(path, legacyRequest("ping"));
      expect(res.status, path).toBe(404);
      expect(await res.text()).toBe("Not found");
    }
  });

  test("with no or a too short CONNECTOR_SECRET every request answers 404", async () => {
    for (const configured of ["", "short"]) {
      const t = setup({ CONNECTOR_SECRET: configured });
      const res = await t.fetch(`/mcp/${configured}`, legacyRequest("ping"));
      expect(res.status).toBe(404);
    }
  });

  test("GET and DELETE answer 405 with the right secret and 404 without it", async () => {
    const t = setup();
    expect((await t.fetch(MCP, { method: "GET" })).status).toBe(405);
    expect((await t.fetch(MCP, { method: "DELETE" })).status).toBe(405);
    expect((await t.fetch("/mcp/nope-nope-nope-nope", { method: "GET" })).status).toBe(404);
  });

  test("a CORS preflight gets 204 with the MCP headers allowed", async () => {
    const t = setup();
    const res = await t.fetch(MCP, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("Mcp-Session-Id");
  });

  test("an Origin outside ALLOWED_ORIGINS gets 403, a listed one passes", async () => {
    const t = setup({ ALLOWED_ORIGINS: "https://grok.com" });
    const denied = await post(t, legacyRequest("ping", undefined, { Origin: "https://evil.example" }));
    expect(denied.status).toBe(403);
    const allowed = await post(t, legacyRequest("ping", undefined, { Origin: "https://grok.com" }));
    expect(allowed.status).toBe(200);
  });
});

describe("secret as a bearer header", () => {
  const withAuth = (value: string, init: RequestInit = legacyRequest("ping")): RequestInit => ({
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: value },
  });

  test("the right bearer token at bare /mcp reaches the MCP server", async () => {
    const t = setup();
    const { status, body } = await post(t, withAuth(`Bearer ${SECRET}`), "/mcp");
    expect(status).toBe(200);
    expect(body.result).toEqual({});
  });

  test("the scheme is case-insensitive and whitespace is trimmed", async () => {
    const t = setup();
    const { status } = await post(t, withAuth(`  bearer   ${SECRET}  `), "/mcp");
    expect(status).toBe(200);
  });

  test("a trailing slash /mcp/ with the bearer token works", async () => {
    const t = setup();
    const { status, body } = await post(t, withAuth(`Bearer ${SECRET}`), "/mcp/");
    expect(status).toBe(200);
    expect(body.result).toEqual({});
  });

  test("a wrong token, another scheme or no header at /mcp answers a plain 404, never 401", async () => {
    const t = setup();
    const inits = [
      withAuth("Bearer wrong-secret-0123456789"),
      withAuth(`Basic ${SECRET}`),
      withAuth(SECRET),
      legacyRequest("ping"),
    ];
    for (const init of inits) {
      const res = await t.fetch("/mcp", init);
      expect(res.status).toBe(404);
      expect(res.headers.get("www-authenticate")).toBeNull();
      expect(await res.text()).toBe("Not found");
    }
  });

  test("a bearer token never works with a too short CONNECTOR_SECRET", async () => {
    const t = setup({ CONNECTOR_SECRET: "short" });
    expect((await t.fetch("/mcp", withAuth("Bearer short"))).status).toBe(404);
  });

  test("with both credentials either valid one authorizes", async () => {
    const t = setup();
    expect((await post(t, withAuth("Bearer wrong-secret-0123456789"))).status).toBe(200);
    expect((await post(t, withAuth(`Bearer ${SECRET}`), "/mcp/wrong-secret-0123456789")).status).toBe(200);
  });

  test("GET and DELETE at /mcp answer 405 with the token and 404 without it", async () => {
    const t = setup();
    for (const method of ["GET", "DELETE"]) {
      expect((await t.fetch("/mcp", withAuth(`Bearer ${SECRET}`, { method }))).status).toBe(405);
      expect((await t.fetch("/mcp", { method })).status).toBe(404);
    }
  });

  test("a CORS preflight at /mcp gets 204 and allows the Authorization header", async () => {
    const t = setup();
    const res = await t.fetch("/mcp", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
  });
});

describe("legacy handshake (2025-11-25 and earlier)", () => {
  test("initialize echoes a supported legacy version and describes the server", async () => {
    const t = setup();
    const { status, body } = await post(
      t,
      legacyRequest("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: { roots: {} },
        clientInfo: { name: "Grok", version: "9.9" },
      }),
    );
    expect(status).toBe(200);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "agent-relay" },
    });
    expect(body.result.instructions).toContain("wait_for_task");
    expect(body.result.resultType).toBeUndefined();
  });

  test("initialize with an unknown version answers the latest legacy version", async () => {
    const t = setup();
    const { body } = await post(t, legacyRequest("initialize", { protocolVersion: "1999-01-01", capabilities: {} }));
    expect(body.result.protocolVersion).toBe("2025-11-25");
  });

  test("notifications/initialized is accepted with 202 and no body", async () => {
    const t = setup();
    const res = await t.fetch(MCP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  test("tools/list returns the five tools with schemas and wait instructions", async () => {
    const t = setup();
    const { body } = await post(t, legacyRequest("tools/list"));
    type Tool = {
      name: string;
      description: string;
      inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] };
    };
    const tools = body.result.tools as Tool[];
    expect(tools.map((tool) => tool.name)).toEqual([
      "send_task",
      "wait_for_task",
      "task_status",
      "list_tasks",
      "list_projects",
    ]);
    for (const tool of tools) expect(tool.inputSchema.type).toBe("object");
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(Object.keys(byName.send_task?.inputSchema.properties ?? {})).toEqual(["request", "project", "follow_up_of"]);
    expect(byName.send_task?.inputSchema.required).toEqual(["request"]);
    expect(byName.send_task?.description).toContain("call it again every time it says the task is still running");
    expect(byName.wait_for_task?.inputSchema.required).toEqual(["name"]);
    expect(byName.wait_for_task?.description).toContain("about 50 seconds");
    expect(byName.wait_for_task?.description).toContain("follow_up_of");
    expect(Object.keys(byName.list_tasks?.inputSchema.properties ?? {})).toEqual(["project"]);
    const all = JSON.stringify(tools);
    expect(all).not.toMatch(/test connector|fake|spike/i);
  });

  test("the wait time in tool descriptions follows WAIT_SECONDS", async () => {
    const t = setup({ WAIT_SECONDS: "25" });
    const { body } = await post(t, legacyRequest("tools/list"));
    expect(body.result.tools[1].description).toContain("about 25 seconds");
  });

  test("an unknown method answers -32601 with HTTP 200", async () => {
    const t = setup();
    const { status, body } = await post(t, legacyRequest("resources/list"));
    expect(status).toBe(200);
    expect(body.error.code).toBe(-32601);
  });

  test("an unknown tool answers -32602", async () => {
    const t = setup();
    const { body } = await post(t, legacyRequest("tools/call", { name: "rm_rf", arguments: {} }));
    expect(body.error).toMatchObject({ code: -32602, message: "Unknown tool: rm_rf" });
  });

  test("malformed JSON answers 400 with a parse error", async () => {
    const t = setup();
    const { status, body } = await post(t, { method: "POST", body: "{nope" });
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32700);
  });
});

describe("modern per-request metadata (2026-07-28)", () => {
  test("tools/list carries resultType and serverInfo", async () => {
    const t = setup();
    const { status, body } = await post(t, modernRequest("tools/list"));
    expect(status).toBe(200);
    expect(body.result.resultType).toBe("complete");
    expect(body.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("agent-relay");
    expect(body.result.tools).toHaveLength(5);
  });

  test("server/discover lists every supported version", async () => {
    const t = setup();
    const { body } = await post(t, modernRequest("server/discover"));
    expect(body.result.supportedVersions).toEqual(["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"]);
  });

  test("missing mirrored headers answer 400 HeaderMismatch", async () => {
    const t = setup();
    const { status, body } = await post(t, modernRequest("tools/list", {}, {}));
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32020);
  });

  test("an unsupported version answers 400 with the supported list", async () => {
    const t = setup();
    const init = legacyRequest(
      "tools/list",
      { _meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01", "io.modelcontextprotocol/clientCapabilities": {} } },
      { "MCP-Protocol-Version": "2099-01-01", "Mcp-Method": "tools/list" },
    );
    const { status, body } = await post(t, init);
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32022);
    expect(body.error.data).toMatchObject({ requested: "2099-01-01" });
  });

  test("an unknown method answers 404 with -32601", async () => {
    const t = setup();
    const { status, body } = await post(t, modernRequest("resources/list"));
    expect(status).toBe(404);
    expect(body.error.code).toBe(-32601);
  });

  test("tools/call works and accepts a base64 Mcp-Name header", async () => {
    const t = setup();
    const init = modernRequest(
      "tools/call",
      { name: "list_tasks", arguments: {} },
      { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": `=?base64?${btoa("list_tasks")}?=` },
    );
    const { status, body } = await post(t, init);
    expect(status).toBe(200);
    expect(body.result.content[0].text).toBe("There are no tasks yet.");
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MCP, SECRET, callTool, legacyRequest, modernRequest, post, setup } from "./test.helpers";
import { clock } from "./toolRunner";

const START = new Date("2026-10-11T10:00:00Z").getTime();
const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.spyOn(clock, "sleep").mockImplementation(async (ms) => {
    vi.advanceTimersByTime(ms);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("calls table", () => {
  test("records client info from initialize and the user agent", async () => {
    const t = setup();
    await post(
      t,
      legacyRequest("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: { sampling: {} },
        clientInfo: { name: "Grok", version: "1.2.3" },
      }),
    );
    const [call] = await t.run((ctx) => ctx.db.query("calls").collect());
    expect(call).toMatchObject({
      at: START,
      httpMethod: "POST",
      httpStatus: 200,
      rpcMethod: "initialize",
      era: "legacy",
      protocolVersion: "2025-06-18",
      clientName: "Grok",
      clientVersion: "1.2.3",
      capabilities: '{"sampling":{}}',
      userAgent: "spike-test/1.0",
      responseSummary: "initialize ok, answered protocol 2025-06-18",
    });
  });

  test("records modern _meta client info", async () => {
    const t = setup();
    await post(t, modernRequest("ping"));
    const [call] = await t.run((ctx) => ctx.db.query("calls").collect());
    expect(call).toMatchObject({ era: "modern", clientName: "ModernClient", protocolVersion: "2026-07-28" });
    const text = await (await t.fetch(`/log/${SECRET}?format=text`)).text();
    expect(text).toContain('user agent "spike-test/1.0": client ModernClient 2.0.0, protocol 2026-07-28');
  });

  test("records tool name, arguments, response, task and delivery", async () => {
    const t = setup();
    await callTool(t, "send_to_claude", { task: "2 minute test" });
    await callTool(t, "wait_for_task", { name: "Test task 1" });
    const calls = await t.run((ctx) => ctx.db.query("calls").collect());
    const [task] = await t.run((ctx) => ctx.db.query("tasks").collect());
    expect(calls[0]).toMatchObject({ tool: "send_to_claude", args: '{"task":"2 minute test"}', taskId: task?._id });
    expect(calls[1]).toMatchObject({
      tool: "wait_for_task",
      durationMs: 50_000,
      finalDelivered: false,
      taskId: task?._id,
    });
    expect(calls[1]?.responseSummary).toContain("still running");
  });

  test("records GET attempts and notifications, but nothing for a wrong secret", async () => {
    const t = setup();
    await t.fetch(MCP, { method: "GET" });
    await t.fetch(MCP, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    await t.fetch("/mcp/wrong-secret-0123456789", legacyRequest("ping"));
    const calls = await t.run((ctx) => ctx.db.query("calls").collect());
    expect(calls.map((c) => [c.httpMethod, c.httpStatus, c.rpcMethod])).toEqual([
      ["GET", 405, undefined],
      ["POST", 202, "notifications/initialized"],
    ]);
  });
});

describe("auth method", () => {
  test("records bearer or path per call and never logs the secret", async () => {
    const t = setup();
    const bearer = legacyRequest("ping", undefined, { Authorization: `Bearer ${SECRET}` });
    await post(t, bearer, "/mcp");
    vi.setSystemTime(START + 1000);
    await post(t, legacyRequest("tools/list"));

    const json = await (await t.fetch(`/log/${SECRET}`)).text();
    const body = JSON.parse(json);
    expect(body.calls.map((c: { rpcMethod: string; auth: string }) => [c.rpcMethod, c.auth])).toEqual([
      ["tools/list", "path"],
      ["ping", "bearer"],
    ]);
    const text = await (await t.fetch(`/log/${SECRET}?format=text`)).text();
    expect(text).toContain('user agent "spike-test/1.0": no clientInfo, auth bearer, path');
    expect(json).not.toContain(SECRET);
    expect(text).not.toContain(SECRET);
  });
});

describe("/log endpoint", () => {
  test("needs the secret", async () => {
    const t = setup();
    expect((await t.fetch("/log/wrong-secret-0123456789")).status).toBe(404);
    expect((await t.fetch(`/log/${SECRET}`)).status).toBe(200);
  });

  test("returns calls newest first with the summary", async () => {
    const t = setup();
    await post(t, legacyRequest("tools/list"));
    vi.setSystemTime(START + 1000);
    await post(t, legacyRequest("ping"));
    const body = await (await t.fetch(`/log/${SECRET}`)).json();
    expect(body.calls.map((c: { rpcMethod: string }) => c.rpcMethod)).toEqual(["ping", "tools/list"]);
    expect(body.summary).toContain("2 recent requests, 0 recent tasks");
  });

  test("text summary shows each check, gaps and that the result was delivered", async () => {
    const t = setup();
    await callTool(t, "send_to_claude", { task: "2 minute test" }); // 10:00:00
    vi.setSystemTime(START + 5_000);
    await callTool(t, "wait_for_task", { name: "Test task 1" }); // 10:00:05, holds 50s
    vi.setSystemTime(START + 90_000);
    await callTool(t, "wait_for_task", { name: "Test task 1" }); // 10:01:30, done at 10:02:00

    const res = await t.fetch(`/log/${SECRET}?format=text`);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("Test task 1 (2 min): created 2026-10-11 10:00:00, finishes 2026-10-11 10:02:00, done.");
    expect(text).toContain("Checks: 2 (wait_for_task 2, task_status 0)");
    expect(text).toMatch(/10:00:05 {2}wait_for_task {2}gap {6}5s {2}held {5}50s/);
    expect(text).toMatch(/10:01:30 {2}wait_for_task {2}gap {5}35s {2}held {5}30s {2}Test task 1 is done/);
    expect(text).toContain("Final result delivered to Grok: yes, at 2026-10-11 10:02:00, 2m 00s after creation.");
    expect(text).toContain('Clients seen:\n  user agent "spike-test/1.0": no clientInfo');
  });

  test("text summary says when the client gave up before the task finished", async () => {
    const t = setup();
    await callTool(t, "send_to_claude", { task: "30 minute test" });
    vi.setSystemTime(START + 5 * MINUTE);
    await callTool(t, "task_status", { name: "last" });
    vi.setSystemTime(START + 40 * MINUTE);

    const text = await (await t.fetch(`/log/${SECRET}?format=text&tz=Europe/Tallinn`)).text();
    expect(text).toContain("created 2026-10-11 13:00:00");
    expect(text).toContain("Last call: 2026-10-11 13:05:00 (25m 00s before the finish time).");
    expect(text).toContain(
      "Final result delivered to Grok: NO. The client stopped checking 5m 00s after creation, 25m 00s before the task finished.",
    );
  });
});

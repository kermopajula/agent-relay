import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installFakeRoutineApi, type FakeRoutineApi } from "./fakeRoutineApi.helpers";
import {
  MCP,
  SECRET,
  addProject,
  allTasks,
  callTool,
  legacyRequest,
  modernRequest,
  post,
  secretFrom,
  setup,
  tokenFor,
} from "./test.helpers";
import { clock } from "./toolRunner";

const START = new Date("2026-10-11T10:00:00Z").getTime();
const MINUTE = 60_000;
let api: FakeRoutineApi;

beforeEach(() => {
  api = installFakeRoutineApi();
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.spyOn(clock, "sleep").mockImplementation(async (ms) => {
    vi.advanceTimersByTime(ms);
  });
});

afterEach(() => {
  expect(api.unexpected).toEqual([]);
  vi.unstubAllGlobals();
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
      userAgent: "relay-test/1.0",
      responseSummary: "initialize ok, answered protocol 2025-06-18",
    });
  });

  test("records modern _meta client info", async () => {
    const t = setup();
    await post(t, modernRequest("ping"));
    const [call] = await t.run((ctx) => ctx.db.query("calls").collect());
    expect(call).toMatchObject({ era: "modern", clientName: "ModernClient", protocolVersion: "2026-07-28" });
    const text = await (await t.fetch(`/log/${SECRET}?format=text`)).text();
    expect(text).toContain('user agent "relay-test/1.0": client ModernClient 2.0.0, protocol 2026-07-28');
  });

  test("records tool name, arguments, response, task and delivery", async () => {
    const t = setup();
    await addProject(t, api, "legacy-mainframes");
    await callTool(t, "send_task", { request: "start a new bug sweep" });
    await callTool(t, "wait_for_task", { name: "last" });
    const calls = await t.run((ctx) => ctx.db.query("calls").collect());
    const [task] = await allTasks(t);
    expect(calls[0]).toMatchObject({
      tool: "send_task",
      args: '{"request":"start a new bug sweep"}',
      taskId: task?._id,
      endpoint: "mcp",
    });
    expect(calls[1]).toMatchObject({
      tool: "wait_for_task",
      durationMs: 50_000,
      finalDelivered: false,
      taskId: task?._id,
    });
    expect(calls[1]?.responseSummary).toContain("has not checked in yet");
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
    expect(text).toContain('user agent "relay-test/1.0": no clientInfo, auth bearer, path');
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

  test("text summary shows project, request, status history, waits with gaps and delivery", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    await callTool(t, "send_task", { request: "fix the login crash" }); // 10:00:00
    const [task] = await allTasks(t);
    vi.setSystemTime(START + 5_000);
    await callTool(t, "wait_for_task", { name: "last" }); // 10:00:05, holds 50s
    vi.setSystemTime(START + 90_000);
    await t.run(async (ctx) => {
      await ctx.db.patch("tasks", task!._id, { status: "done", name: "Fix login crash", finalAt: START + 90_000 });
      await ctx.db.insert("taskEvents", { taskId: task!._id, at: START + 90_000, status: "done", source: "report" });
    });
    vi.setSystemTime(START + 95_000);
    await callTool(t, "wait_for_task", { name: "login crash" }); // 10:01:35, returns at once

    const res = await t.fetch(`/log/${SECRET}?format=text`);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("Fix login crash [legacy-monolith]: done, sent 2026-10-11 10:00:00.");
    expect(text).toContain('Request: "fix the login crash"');
    expect(text).toContain("Session: https://claude.ai/code/session_01TEST");
    expect(text).toMatch(/2026-10-11 10:00:00 {2}sent {12}relay: routine fired/);
    expect(text).toMatch(/2026-10-11 10:01:30 {2}done {12}report/);
    expect(text).toContain("Assistant calls: 3 (wait_for_task 2, task_status 0)");
    expect(text).toMatch(/10:00:05 {2}wait_for_task {2}gap {6}5s {2}held {5}50s/);
    expect(text).toMatch(/10:01:35 {2}wait_for_task {2}gap {5}40s {2}held {6}0s {2}Claude finished Fix login crash in Legacy Monolith/);
    expect(text).toContain("Delivered to assistant: yes, at 2026-10-11 10:01:35, 1m 35s after sending.");
    expect(text).toContain('Clients seen:\n  user agent "relay-test/1.0": no clientInfo');
  });

  test("text summary says when the assistant stopped checking before the final status", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    await callTool(t, "send_task", { request: "fix the login crash" });
    const [task] = await allTasks(t);
    vi.setSystemTime(START + 5 * MINUTE);
    await callTool(t, "task_status", { name: "last" });
    await t.run((ctx) => ctx.db.patch("tasks", task!._id, { status: "done", finalAt: START + 30 * MINUTE }));
    vi.setSystemTime(START + 40 * MINUTE);

    const text = await (await t.fetch(`/log/${SECRET}?format=text&tz=Europe/Helsinki`)).text();
    expect(text).toContain("sent 2026-10-11 13:00:00");
    expect(text).toContain(
      "Delivered to assistant: NO. The assistant stopped checking 5m 00s after sending, 25m 00s before the final status.",
    );
  });

  test("the log never contains a project token, a report secret or its hash", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    await callTool(t, "send_task", { request: "fix the login crash" });
    const secret = secretFrom(api.fires[0]?.text ?? "");
    const [task] = await allTasks(t);
    for (const path of [`/log/${SECRET}`, `/log/${SECRET}?format=text`]) {
      const body = await (await t.fetch(path)).text();
      expect(body).toContain("fix the login crash");
      expect(body).not.toContain(tokenFor("legacy-monolith"));
      expect(body).not.toContain(secret);
      expect(body).not.toContain(task!.reportSecretHash);
      expect(body).not.toContain("reportSecretHash");
      expect(body).not.toContain(SECRET);
    }
  });
});

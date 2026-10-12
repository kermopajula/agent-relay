import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installFakeRoutineApi, type FakeRoutineApi } from "./fakeRoutineApi.helpers";
import { SECRET, SITE_URL, addProject, allTasks, callTool, reportUrlFrom, secretFrom, setup, type TestConvex } from "./test.helpers";
import { clock } from "./toolRunner";

const START = new Date("2026-10-11T10:00:00Z").getTime();
let api: FakeRoutineApi;
let onSleep: (count: number) => Promise<void> = async () => {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  api = installFakeRoutineApi();
  onSleep = async () => {};
  let count = 0;
  vi.spyOn(clock, "sleep").mockImplementation(async (ms) => {
    vi.advanceTimersByTime(ms);
    await onSleep(++count);
  });
});

afterEach(() => {
  expect(api.unexpected).toEqual([]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type Sent = { path: string; secret: string };

async function send(t: TestConvex, request = "fix the login crash"): Promise<Sent> {
  await callTool(t, "send_task", { request });
  const text = api.fires[api.fires.length - 1]?.text ?? "";
  return { path: reportUrlFrom(text).slice(SITE_URL.length), secret: secretFrom(text) };
}

async function report(t: TestConvex, sent: Sent, body: unknown, secret = sent.secret) {
  const res = await t.fetch(sent.path, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", "User-Agent": "curl/8.5.0" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text.startsWith("{") ? JSON.parse(text) : text };
}

async function onlyTask(t: TestConvex) {
  const [task] = await allTasks(t);
  if (!task) throw new Error("no task");
  return task;
}

describe("report auth", () => {
  test("the task's secret is accepted and the report is applied", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    const sent = await send(t);
    vi.setSystemTime(START + 40_000);

    const result = await report(t, sent, { status: "running", name: "Fix login crash" });

    expect(result).toEqual({ status: 200, body: { ok: true, name: "Fix login crash", status: "running" } });
    expect(await onlyTask(t)).toMatchObject({
      name: "Fix login crash",
      sentName: "new Legacy Monolith task, sent 10:00",
      nameReported: true,
      status: "running",
      lastReportAt: START + 40_000,
    });
    const events = await t.run((ctx) => ctx.db.query("taskEvents").collect());
    expect(events.map((e) => [e.status, e.source, e.note])).toEqual([
      ["sent", "relay", "routine fired"],
      ["running", "report", 'named "Fix login crash"'],
    ]);
  });

  test("a wrong secret, another task's secret or no bearer answers 404 and changes nothing", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    const first = await send(t, "one");
    const second = await send(t, "two");
    const body = JSON.stringify({ status: "done" });
    for (const headers of [
      { Authorization: "Bearer wrong-secret" },
      { Authorization: `Bearer ${second.secret}` },
      { Authorization: first.secret },
      {} as Record<string, string>,
    ]) {
      const res = await t.fetch(first.path, { method: "POST", headers, body });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
    }
    expect((await allTasks(t)).map((task) => task.status)).toEqual(["sent", "sent"]);
    const reports = await t.run((ctx) => ctx.db.query("calls").collect());
    expect(reports.filter((c) => c.endpoint === "report")).toEqual([]);
  });

  test("an unknown or malformed task id answers 404", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    const sent = await send(t);
    const otherTable = (await t.run((ctx) => ctx.db.query("projects").first()))!._id;
    for (const path of ["/report/not-an-id", `/report/${otherTable}`, `${sent.path}/extra`, "/report/"]) {
      expect((await report(t, { ...sent, path }, { status: "done" })).status, path).toBe(404);
    }
  });

  test("a bad body with the right secret is a 400, with a wrong secret a 404", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    const sent = await send(t);
    const bad = await report(t, sent, { status: "done", secret: "x" });
    expect(bad.status).toBe(400);
    const wrongSecret = await report(t, sent, { status: "done", secret: "x" }, "wrong");
    expect(wrongSecret.status).toBe(404);
  });
});

describe("report validation", () => {
  test.each([
    ["not JSON", "{nope", "The body must be JSON."],
    ["an array", [], "The body must be a JSON object."],
    ["an unknown field", { status: "done", url: "x" }, "Unknown field: url. Allowed fields: status, name, summary, question, pr_url, branch."],
    ["a missing status", { name: "x" }, 'status must be one of "running", "done", "failed", "needs_input".'],
    ["a status the relay sets", { status: "timed_out" }, 'status must be one of "running", "done", "failed", "needs_input".'],
    ["a long name", { status: "running", name: "x".repeat(61) }, "name must be at most 60 characters; it has 61."],
    ["a long summary", { status: "done", summary: "x".repeat(601) }, "summary must be at most 600 characters; it has 601."],
    ["a number as summary", { status: "done", summary: 3 }, "summary must be a string."],
    ["needs_input without a question", { status: "needs_input" }, "A needs_input report must include question."],
    ["an http PR link", { status: "done", pr_url: "http://github.com/a/b/pull/1" }, "pr_url must be an https URL."],
  ])("rejects %s with a clear message", async (_label, body, message) => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    const sent = await send(t);
    const result = await report(t, sent, body);
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ ok: false, error: message });
    expect((await onlyTask(t)).status).toBe("sent");
  });

  test("null and empty optional fields count as missing", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    const sent = await send(t);
    const result = await report(t, sent, { status: "done", name: "", summary: "Done.", pr_url: null, branch: "  " });
    expect(result.status).toBe(200);
    const task = await onlyTask(t);
    expect(task).toMatchObject({ status: "done", summary: "Done.", name: "new Legacy Monolith task, sent 10:00" });
    expect(task.prUrl).toBeUndefined();
    expect(task.branch).toBeUndefined();
  });
});

describe("report lifecycle", () => {
  test("sent, running, done; then 409 and the final result stays", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    const sent = await send(t);
    expect((await report(t, sent, { status: "running", name: "Fix login crash" })).status).toBe(200);
    vi.setSystemTime(START + 10 * 60_000);
    const done = {
      status: "done",
      summary: "Fixed the login crash. Draft PR 412 is ready.",
      pr_url: "https://github.com/acme/app/pull/412",
      branch: "fix/login-crash",
    };
    expect((await report(t, sent, done)).status).toBe(200);
    const late = await report(t, sent, { status: "failed", summary: "oops" });
    expect(late.status).toBe(409);
    expect(late.body.error).toContain("already has the final status done");
    expect(await onlyTask(t)).toMatchObject({
      status: "done",
      summary: "Fixed the login crash. Draft PR 412 is ready.",
      prUrl: "https://github.com/acme/app/pull/412",
      branch: "fix/login-crash",
      finalAt: START + 10 * 60_000,
    });
  });

  test("needs_input is final for the task: a follow-up carries the answer", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    const sent = await send(t, "release the new version");
    await report(t, sent, { status: "needs_input", name: "Release 2.4.0", question: "Publish 2.4.0 now?" });
    expect((await report(t, sent, { status: "running" })).status).toBe(409);
    const answer = await callTool(t, "send_task", { request: "yes, go ahead", follow_up_of: "Release 2.4.0" });
    expect(answer.text).toContain("Claude is on it in Legacy Monolith.");
    expect(api.fires[1]?.text).toContain("Question you asked: Publish 2.4.0 now?");
  });

  test("the first reported name sticks and duplicates get a number", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    const first = await send(t, "one");
    const second = await send(t, "two");
    await report(t, first, { status: "running", name: "Fix login crash" });
    const renamed = await report(t, second, { status: "running", name: "Fix login crash" });
    expect(renamed.body.name).toBe("Fix login crash (2)");
    await report(t, first, { status: "running", name: "Something else" });
    expect((await allTasks(t)).map((task) => task.name)).toEqual(["Fix login crash", "Fix login crash (2)"]);
  });

  test("wait_for_task hands back a report that arrives during the wait", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    const sent = await send(t);
    onSleep = async (count) => {
      if (count === 1) await report(t, sent, { status: "running", name: "Fix login crash" });
      if (count === 4) await report(t, sent, { status: "done", summary: "Fixed it." });
    };
    const result = await callTool(t, "wait_for_task", { name: "new Legacy Monolith task, sent 10:00" });
    expect(result.text).toBe("Claude finished Fix login crash in Legacy Monolith. Fixed it.");
  });

  test("every report is logged with its body and never the secret", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    const sent = await send(t);
    await report(t, sent, { status: "running", name: "Fix login crash" });
    await report(t, sent, { status: "running", name: "x".repeat(61) });
    const reports = (await t.run((ctx) => ctx.db.query("calls").collect())).filter((c) => c.endpoint === "report");
    expect(reports.map((c) => [c.httpStatus, c.responseSummary, c.userAgent])).toEqual([
      [200, "Accepted running.", "curl/8.5.0"],
      [400, "name must be at most 60 characters; it has 61.", "curl/8.5.0"],
    ]);
    expect(reports[0]?.args).toBe('{"status":"running","name":"Fix login crash"}');

    const text = await (await t.fetch(`/log/${SECRET}?format=text`)).text();
    expect(text).toContain("Reports: 2");
    expect(text).toMatch(/HTTP 200 {2}\{"status":"running","name":"Fix login crash"\} {2}Accepted running\./);
    expect(text).not.toContain(sent.secret);
    expect(await (await t.fetch(`/log/${SECRET}`)).text()).not.toContain(sent.secret);
  });
});

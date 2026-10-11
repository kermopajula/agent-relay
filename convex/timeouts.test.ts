import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installFakeRoutineApi, type FakeRoutineApi } from "./fakeRoutineApi.helpers";
import { SITE_URL, addProject, allTasks, callTool, reportUrlFrom, secretFrom, setup, type TestConvex } from "./test.helpers";
import { clock } from "./toolRunner";

const START = new Date("2026-10-11T10:00:00Z").getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const SENT = "new Begin Mobile task, sent 10:00";
let api: FakeRoutineApi;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  api = installFakeRoutineApi();
  vi.spyOn(clock, "sleep").mockImplementation(async (ms) => {
    vi.advanceTimersByTime(ms);
  });
});

afterEach(() => {
  expect(api.unexpected).toEqual([]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function send(t: TestConvex) {
  await addProject(t, api, "begin-mobile");
  await callTool(t, "send_task", { request: "fix the login crash" });
  const text = api.fires[0]?.text ?? "";
  return { path: reportUrlFrom(text).slice(SITE_URL.length), secret: secretFrom(text) };
}

async function report(t: TestConvex, sent: { path: string; secret: string }, body: unknown) {
  const res = await t.fetch(sent.path, {
    method: "POST",
    headers: { Authorization: `Bearer ${sent.secret}` },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function advance(t: TestConvex, ms: number) {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
}

async function status(t: TestConvex) {
  return (await allTasks(t))[0]?.status;
}

describe("no start report", () => {
  test("15 minutes without any report marks the task and explains the likely cause", async () => {
    const t = setup({ WAIT_SECONDS: "0" });
    await send(t);
    await advance(t, 15 * MINUTE - 1);
    expect(await status(t)).toBe("sent");
    await advance(t, 1);
    expect(await status(t)).toBe("no_start_report");

    const result = await callTool(t, "wait_for_task", { name: SENT });
    expect(result.text).toContain(
      "Claude hasn't checked in yet; open the session link to see why. " +
        "A common cause is the relay's domain missing from the routine environment's allowed domains.",
    );
    expect(result.text).toContain("Session link: https://claude.ai/code/session_01TEST");
    expect(result.text).toContain("call wait_for_task again");
  });

  test("a later report is still accepted", async () => {
    const t = setup();
    const sent = await send(t);
    await advance(t, 20 * MINUTE);
    expect(await report(t, sent, { status: "running", name: "Fix login crash" })).toBe(200);
    expect(await status(t)).toBe("running");
  });

  test("a report before the deadline keeps the task running", async () => {
    const t = setup();
    const sent = await send(t);
    await report(t, sent, { status: "running" });
    await advance(t, 15 * MINUTE);
    expect(await status(t)).toBe("running");
  });
});

describe("timed out", () => {
  test("no final report after TASK_TIMEOUT_HOURS marks the task timed out, final for wait_for_task", async () => {
    const t = setup();
    const sent = await send(t);
    await report(t, sent, { status: "running", name: "Fix login crash" });
    await advance(t, 6 * HOUR - 1);
    expect(await status(t)).toBe("running");
    await advance(t, 1);
    expect(await status(t)).toBe("timed_out");

    const result = await callTool(t, "wait_for_task", { name: "login crash" });
    expect(result.text).toContain(
      "Fix login crash has sent no final report in 6 hours, so I stopped waiting. Open the session link to check on it.",
    );
    expect((await allTasks(t))[0]?.deliveredAt).toBe(START + 6 * HOUR);
  });

  test("TASK_TIMEOUT_HOURS changes the deadline", async () => {
    const t = setup({ TASK_TIMEOUT_HOURS: "1" });
    await send(t);
    await advance(t, HOUR);
    expect(await status(t)).toBe("timed_out");
  });

  test("a late final report overrides timed_out and is delivered again", async () => {
    const t = setup();
    const sent = await send(t);
    await advance(t, 6 * HOUR);
    await callTool(t, "task_status", { name: "last" });
    expect((await allTasks(t))[0]?.deliveredAt).toBeDefined();

    expect(await report(t, sent, { status: "done", name: "Fix login crash", summary: "Fixed it." })).toBe(200);
    const [task] = await allTasks(t);
    expect(task).toMatchObject({ status: "done", name: "Fix login crash" });
    expect(task?.deliveredAt).toBeUndefined();
    expect((await callTool(t, "wait_for_task", { name: "last" })).text).toBe(
      "Begin Mobile finished Fix login crash. Fixed it.",
    );
  });

  test("a finished task is left alone by both timers", async () => {
    const t = setup();
    const sent = await send(t);
    await report(t, sent, { status: "done", summary: "Done." });
    await advance(t, 7 * HOUR);
    expect(await status(t)).toBe("done");
    const events = await t.run((ctx) => ctx.db.query("taskEvents").collect());
    expect(events.map((e) => e.status)).toEqual(["sent", "done"]);
  });

  test("a failed fire schedules no timers", async () => {
    const t = setup();
    await addProject(t, api, "begin-mobile");
    api.failNext(500);
    await callTool(t, "send_task", { request: "sweep" });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Doc } from "./_generated/dataModel";
import { installFakeRoutineApi, type FakeRoutineApi } from "./fakeRoutineApi.helpers";
import { addProject, allTasks, callTool, setup, type TestConvex } from "./test.helpers";
import { clock } from "./toolRunner";

const START = new Date("2026-10-11T10:00:00Z").getTime();
const sleeps: number[] = [];
let api: FakeRoutineApi;
// Runs once per fake sleep, so a test can change the task in the middle of a wait.
let onSleep: (count: number) => Promise<void> = async () => {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  sleeps.length = 0;
  onSleep = async () => {};
  api = installFakeRoutineApi();
  vi.spyOn(clock, "sleep").mockImplementation(async (ms) => {
    sleeps.push(ms);
    vi.advanceTimersByTime(ms);
    await onSleep(sleeps.length);
  });
});

afterEach(() => {
  expect(api.unexpected).toEqual([]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function sendOne(t: TestConvex, request = "fix the login crash") {
  await addProject(t, api, "legacy-monolith");
  await callTool(t, "send_task", { request });
  const [task] = await allTasks(t);
  if (!task) throw new Error("no task");
  return task;
}

async function patchTask(t: TestConvex, task: Doc<"tasks">, fields: Partial<Doc<"tasks">>) {
  await t.run((ctx) => ctx.db.patch("tasks", task._id, fields));
}

const SENT = "new Legacy Monolith task, sent 10:00";

describe("wait_for_task", () => {
  test("polls every two seconds for WAIT_SECONDS, then says it is still running", async () => {
    const t = setup();
    await sendOne(t);
    const result = await callTool(t, "wait_for_task", { name: SENT });
    expect(result.text).toBe(
      `${SENT} is sent to Legacy Monolith. Claude has not checked in yet.\n` +
        `(For the assistant: call wait_for_task again with name "${SENT}" to keep waiting.)`,
    );
    expect(sleeps).toHaveLength(25);
    expect(sleeps.every((ms) => ms === 2_000)).toBe(true);
  });

  test("returns as soon as the task is done, with the summary and PR link", async () => {
    const t = setup();
    const task = await sendOne(t);
    onSleep = async (count) => {
      if (count === 3) {
        await patchTask(t, task, {
          name: "Fix login crash",
          status: "done",
          summary: "Fixed the login crash. Draft PR 412 is ready.",
          prUrl: "https://github.com/acme/app/pull/412",
          finalAt: Date.now(),
        });
      }
    };
    const result = await callTool(t, "wait_for_task", { name: SENT });
    expect(result.text).toBe(
      "Claude finished Fix login crash in Legacy Monolith. Fixed the login crash. Draft PR 412 is ready.\n" +
        "Pull request: https://github.com/acme/app/pull/412",
    );
    expect(sleeps).toEqual([2_000, 2_000, 2_000]);
    expect((await allTasks(t))[0]?.deliveredAt).toBe(START + 6_000);
  });

  test("a needs_input result includes the question and how to answer it", async () => {
    const t = setup();
    const task = await sendOne(t);
    await patchTask(t, task, {
      name: "Release 2.4.0",
      status: "needs_input",
      question: "Publish 2.4.0 to the App Store now?",
    });
    const result = await callTool(t, "wait_for_task", { name: "release" });
    expect(result.text).toContain("Claude needs your answer on Release 2.4.0 in Legacy Monolith. Publish 2.4.0 to the App Store now?");
    expect(result.text).toContain('call send_task with follow_up_of "Release 2.4.0"');
    expect(sleeps).toEqual([]);
  });

  test("a running task reports the time of its last report", async () => {
    const t = setup({ WAIT_SECONDS: "0" });
    const task = await sendOne(t);
    await patchTask(t, task, { name: "Fix login crash", status: "running", lastReportAt: START + 60_000 });
    const result = await callTool(t, "wait_for_task", { name: "login crash" });
    expect(result.text).toContain("Fix login crash is still running. Last report at 10:01.");
    expect(result.text).toContain('call wait_for_task again with name "Fix login crash"');
  });

  test("a failed fire is final at once", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");
    api.failNext(429);
    await callTool(t, "send_task", { request: "sweep" });
    const result = await callTool(t, "wait_for_task", { name: "last" });
    expect(result.text).toBe("Rate limited by Anthropic; try again later.");
    expect(sleeps).toEqual([]);
  });

  test("an unknown name is a tool error that lists recent tasks", async () => {
    const t = setup();
    await sendOne(t);
    const result = await callTool(t, "wait_for_task", { name: "payroll" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(`Recent tasks: ${SENT}.`);
  });
});

describe("task_status and list_tasks", () => {
  test("task_status answers at once and records delivery of a final result", async () => {
    const t = setup();
    const task = await sendOne(t);
    expect((await callTool(t, "task_status", { name: "last" })).text).toBe(
      `${SENT} is sent to Legacy Monolith. Claude has not checked in yet.`,
    );
    await patchTask(t, task, { name: "Fix login crash", status: "failed", summary: "The tests do not build" });
    vi.setSystemTime(START + 60_000);
    expect((await callTool(t, "task_status", { name: "last" })).text).toBe(
      `Claude could not finish Fix login crash in Legacy Monolith. The tests do not build.\nSession link: ${task.sessionUrl}`,
    );
    expect((await allTasks(t))[0]?.deliveredAt).toBe(START + 60_000);
    expect(sleeps).toEqual([]);
  });

  test("list_tasks reads one line per task, newest first, optionally for one project", async () => {
    const t = setup();
    await addProject(t, api, "legacy-mainframes");
    await addProject(t, api, "legacy-monolith");
    await callTool(t, "send_task", { request: "sweep" });
    vi.setSystemTime(START + 60_000);
    await callTool(t, "send_task", { request: "fix it", project: "monolith" });
    const [, monolith] = await allTasks(t);
    await patchTask(t, monolith!, { name: "Fix login crash", status: "running" });

    expect((await callTool(t, "list_tasks")).text).toBe(
      "Fix login crash (Legacy Monolith): running.\nnew Legacy Mainframes task, sent 10:00 (Legacy Mainframes): sent, no report yet.",
    );
    expect((await callTool(t, "list_tasks", { project: "mainframes" })).text).toBe(
      "new Legacy Mainframes task, sent 10:00 (Legacy Mainframes): sent, no report yet.",
    );
    expect((await callTool(t, "list_tasks", { project: "legacy" })).text).toContain("could mean Legacy Mainframes or Legacy Monolith");
  });

  test("list_tasks with no tasks says so", async () => {
    const t = setup();
    expect((await callTool(t, "list_tasks")).text).toBe("There are no tasks yet.");
  });
});

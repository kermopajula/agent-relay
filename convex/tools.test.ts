import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { callTool, setup, type TestConvex } from "./test.helpers";
import { clock } from "./toolRunner";

const START = new Date("2026-10-11T10:00:00Z").getTime();
const MINUTE = 60_000;
const sleeps: number[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  sleeps.length = 0;
  vi.spyOn(clock, "sleep").mockImplementation(async (ms) => {
    sleeps.push(ms);
    vi.advanceTimersByTime(ms);
  });
});

async function tasks(t: TestConvex) {
  return t.run((ctx) => ctx.db.query("tasks").collect());
}

describe("send_to_claude", () => {
  test("uses the duration named in the task text", async () => {
    const t = setup();
    const ten = await callTool(t, "send_to_claude", { task: "Run a 10 minute test task" });
    const thirty = await callTool(t, "send_to_claude", { task: "run a thirty minute test" });
    expect(ten.text).toContain("Started Test task 1. It will take about 10 minutes.");
    expect(ten.text).toContain('call wait_for_task with name "Test task 1"');
    expect(thirty.text).toContain("about 30 minutes");
    const stored = await tasks(t);
    expect(stored.map((task) => task.name)).toEqual(["Test task 1 (10 min)", "Test task 2 (30 min)"]);
    expect(stored[0]?.dueAt).toBe(START + 10 * MINUTE);
  });

  test("cycles 2, 10, 30 minutes when the text names no duration", async () => {
    const t = setup();
    for (let i = 0; i < 4; i++) await callTool(t, "send_to_claude", { task: "do the thing" });
    expect((await tasks(t)).map((task) => task.durationMinutes)).toEqual([2, 10, 30, 2]);
  });

  test("an empty task is a tool error, not a new task", async () => {
    const t = setup();
    const result = await callTool(t, "send_to_claude", { task: "  " });
    expect(result.isError).toBe(true);
    expect(await tasks(t)).toHaveLength(0);
  });
});

describe("scheduler", () => {
  test("marks the task done at its due time even if nobody polls", async () => {
    const t = setup();
    await callTool(t, "send_to_claude", { task: "2 minute test" });
    expect((await tasks(t))[0]?.status).toBe("running");

    vi.advanceTimersByTime(2 * MINUTE);
    await t.finishInProgressScheduledFunctions();

    const [task] = await tasks(t);
    expect(task?.status).toBe("done");
    expect(task?.doneAt).toBe(START + 2 * MINUTE);
    expect(task?.deliveredAt).toBeUndefined();
  });
});

describe("wait_for_task", () => {
  test("holds for WAIT_SECONDS and then reports the time left", async () => {
    const t = setup();
    await callTool(t, "send_to_claude", { task: "10 minute test" });

    const result = await callTool(t, "wait_for_task", { name: "Test task 1" });

    expect(result.text).toBe(
      'Test task 1 is still running, about 10 minutes left. Call wait_for_task again with name "Test task 1" to keep waiting.',
    );
    expect(sleeps).toEqual([50_000]);
  });

  test("returns the final result as soon as the task finishes inside the wait", async () => {
    const t = setup();
    await callTool(t, "send_to_claude", { task: "2 minute test" });
    vi.setSystemTime(START + 2 * MINUTE - 20_000);

    const result = await callTool(t, "wait_for_task", { name: "last" });

    expect(result.text).toBe("Test task 1 is done. It took 2 minutes.");
    expect(sleeps).toEqual([20_000]);
    const [task] = await tasks(t);
    expect(task?.deliveredAt).toBe(START + 2 * MINUTE);
  });

  test("returns at once when the task is already done", async () => {
    const t = setup();
    await callTool(t, "send_to_claude", { task: "2 minute test" });
    vi.setSystemTime(START + 5 * MINUTE);
    const result = await callTool(t, "wait_for_task", { name: "test task 1" });
    expect(result.text).toBe("Test task 1 is done. It took 2 minutes.");
    expect(sleeps).toEqual([]);
  });

  test("WAIT_SECONDS=0 makes it answer immediately", async () => {
    const t = setup({ WAIT_SECONDS: "0" });
    await callTool(t, "send_to_claude", { task: "30 minute test" });
    const result = await callTool(t, "wait_for_task", { name: "" });
    expect(result.text).toContain("about 30 minutes left");
    expect(sleeps).toEqual([]);
  });

  test("an unknown name is a tool error that lists recent tasks", async () => {
    const t = setup();
    await callTool(t, "send_to_claude", { task: "2 minute test" });
    const result = await callTool(t, "wait_for_task", { name: "task 7" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Recent tasks: Test task 1.");
  });
});

describe("task_status and list_tasks", () => {
  test("task_status answers immediately and records delivery once done", async () => {
    const t = setup();
    await callTool(t, "send_to_claude", { task: "10 minute test" });
    vi.setSystemTime(START + 9 * MINUTE + 30_000);
    expect((await callTool(t, "task_status", { name: "Test task 1" })).text).toBe(
      "Test task 1 is still running, less than a minute left.",
    );
    vi.setSystemTime(START + 11 * MINUTE);
    expect((await callTool(t, "task_status", { name: "Test task 1" })).text).toBe(
      "Test task 1 is done. It took 10 minutes.",
    );
    expect((await tasks(t))[0]?.deliveredAt).toBe(START + 11 * MINUTE);
  });

  test("list_tasks reads one line per task, newest first", async () => {
    const t = setup();
    await callTool(t, "send_to_claude", { task: "2 minute test" });
    await callTool(t, "send_to_claude", { task: "30 minute test" });
    vi.setSystemTime(START + 3 * MINUTE);
    const result = await callTool(t, "list_tasks");
    expect(result.text).toBe(
      "Test task 2 (30 min): still running, about 27 minutes left.\nTest task 1 (2 min): done, it took 2 minutes.",
    );
  });
});

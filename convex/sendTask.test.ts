import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installFakeRoutineApi, sessionId, type FakeRoutineApi } from "./fakeRoutineApi.helpers";
import { sha256Hex } from "./lib/crypto";
import {
  SITE_URL,
  addProject,
  allTasks,
  callTool,
  reportUrlFrom,
  routineIdFor,
  secretFrom,
  setup,
  tokenFor,
} from "./test.helpers";

const START = new Date("2026-10-11T10:05:00Z").getTime();
let api: FakeRoutineApi;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  api = installFakeRoutineApi();
});

afterEach(() => {
  expect(api.unexpected).toEqual([]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("send_task", () => {
  test("fires the project's routine and answers with the session link", async () => {
    const t = setup();
    await addProject(t, api, "legacy-monolith");

    const result = await callTool(t, "send_task", { request: "fix the login crash", project: "Legacy Monolith" });

    expect(result.isError).toBe(false);
    expect(result.text).toContain("Claude is on it in Legacy Monolith. I'll know the task's name in about a minute.");
    expect(result.text).toContain(`Session link: https://claude.ai/code/${sessionId(1)}`);
    expect(result.text).toContain('call wait_for_task with name "new Legacy Monolith task, sent 10:05"');
    expect(api.fires).toHaveLength(1);
    expect(api.fires[0]).toMatchObject({ routineId: routineIdFor("legacy-monolith"), token: tokenFor("legacy-monolith") });

    const [task] = await allTasks(t);
    expect(task).toMatchObject({
      name: "new Legacy Monolith task, sent 10:05",
      status: "sent",
      request: "fix the login crash",
      projectName: "legacy-monolith",
      sessionId: sessionId(1),
      sessionUrl: `https://claude.ai/code/${sessionId(1)}`,
      firedAt: START,
    });
  });

  test("the payload carries the request, the report URL, the secret and curl examples", async () => {
    const t = setup();
    await addProject(t, api, "legacy-mainframes");
    await callTool(t, "send_task", { request: "start a new bug sweep" });

    const text = api.fires[0]?.text ?? "";
    const [task] = await allTasks(t);
    expect(text).toContain("Request for the Legacy Mainframes project");
    expect(text).toContain("start a new bug sweep");
    expect(reportUrlFrom(text)).toBe(`${SITE_URL}/report/${task?._id}`);
    const secret = secretFrom(text);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(task?.reportSecretHash).toBe(await sha256Hex(secret));
    expect(text).toContain(`curl -sS -X POST '${SITE_URL}/report/${task?._id}'`);
    expect(text).toContain(`-H 'Authorization: Bearer ${secret}'`);
    expect(text).toContain('{"status": "running", "name": "Fix login crash"}');
    expect(text).toContain('"status": "done"');
    expect(text).toContain('"status": "needs_input"');
    expect(text).not.toContain("Follow-up context");
  });

  test("each task gets its own secret and only its hash is stored", async () => {
    const t = setup();
    await addProject(t, api, "legacy-mainframes");
    await callTool(t, "send_task", { request: "one" });
    await callTool(t, "send_task", { request: "two" });
    const [first, second] = api.fires.map((f) => secretFrom(f.text));
    expect(first).not.toBe(second);
    const stored = JSON.stringify(await allTasks(t));
    expect(stored).not.toContain(first);
    expect(stored).not.toContain(second);
  });

  test("uses the default project when none is named and dedupes the provisional name", async () => {
    const t = setup();
    await addProject(t, api, "legacy-mainframes");
    await addProject(t, api, "legacy-monolith");
    await callTool(t, "send_task", { request: "one" });
    const second = await callTool(t, "send_task", { request: "two" });
    expect(second.text).toContain("Claude is on it in Legacy Mainframes.");
    expect((await allTasks(t)).map((task) => task.name)).toEqual([
      "new Legacy Mainframes task, sent 10:05",
      "new Legacy Mainframes task, sent 10:05 (2)",
    ]);
  });

  test("shows send times in DISPLAY_TIMEZONE", async () => {
    const t = setup({ DISPLAY_TIMEZONE: "Europe/Helsinki" });
    await addProject(t, api, "legacy-mainframes");
    const result = await callTool(t, "send_task", { request: "one" });
    expect(result.text).toContain('"new Legacy Mainframes task, sent 13:05"');
  });

  test("a follow-up carries the earlier task's request, status, question, PR and branch", async () => {
    const t = setup();
    await addProject(t, api, "legacy-mainframes");
    await addProject(t, api, "legacy-monolith");
    await callTool(t, "send_task", { request: "release the new version", project: "monolith" });
    const [earlier] = await allTasks(t);
    await t.run((ctx) =>
      ctx.db.patch("tasks", earlier!._id, {
        name: "Release 2.4.0",
        nameReported: true,
        status: "needs_input",
        summary: "Build 2.4.0 is ready.",
        question: "Publish 2.4.0 to the App Store now?",
        prUrl: "https://github.com/acme/app/pull/412",
        branch: "release/2.4.0",
      }),
    );

    const result = await callTool(t, "send_task", { request: "yes, go ahead", follow_up_of: "release 2.4.0" });

    expect(result.text).toContain("Claude is on it in Legacy Monolith.");
    const text = api.fires[1]?.text ?? "";
    expect(text).toContain("yes, go ahead");
    expect(text).toContain("Follow-up context");
    expect(text).toContain("Earlier request: release the new version");
    expect(text).toContain("Earlier task name: Release 2.4.0");
    expect(text).toContain("Earlier status: needs_input");
    expect(text).toContain("Earlier summary: Build 2.4.0 is ready.");
    expect(text).toContain("Question you asked: Publish 2.4.0 to the App Store now?");
    expect(text).toContain("Pull request: https://github.com/acme/app/pull/412");
    expect(text).toContain("Branch: release/2.4.0");
    expect(text).toContain(`Earlier session: https://claude.ai/code/${sessionId(1)}`);
    expect(api.fires[1]?.routineId).toBe(routineIdFor("legacy-monolith"));
    const tasks = await allTasks(t);
    expect(tasks[1]?.followUpOf).toBe(earlier?._id);
  });

  test("an unknown follow_up_of is a tool error and fires nothing", async () => {
    const t = setup();
    await addProject(t, api, "legacy-mainframes");
    const result = await callTool(t, "send_task", { request: "yes", follow_up_of: "release 9" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('I could not find a task called "release 9"');
    expect(api.fires).toHaveLength(0);
  });

  test("a rejected token fails the task and says how to rotate it", async () => {
    const t = setup();
    await addProject(t, api, "legacy-mainframes");
    api.allow(routineIdFor("legacy-mainframes"), "sk-ant-oat01-some-other-token");

    const result = await callTool(t, "send_task", { request: "sweep" });

    expect(result).toEqual({
      isError: true,
      text: "The token for Legacy Mainframes was rejected. Rotate it with projects:rotateToken.",
    });
    const [task] = await allTasks(t);
    expect(task).toMatchObject({ status: "failed", deliveredAt: START, finalAt: START });
    expect(task?.sessionId).toBeUndefined();
  });

  test.each([
    [429 as const, "Rate limited by Anthropic; try again later."],
    [500 as const, "Claude could not be started in Legacy Mainframes. The routine API answered with status 500."],
    ["network" as const, "Claude could not be started in Legacy Mainframes. The routine API could not be reached."],
  ])("a fire that ends in %s fails the task", async (outcome, message) => {
    const t = setup();
    await addProject(t, api, "legacy-mainframes");
    api.failNext(outcome);
    const result = await callTool(t, "send_task", { request: "sweep" });
    expect(result).toEqual({ isError: true, text: message });
    expect((await allTasks(t))[0]?.status).toBe("failed");
  });

  test("an empty request is a tool error and creates nothing", async () => {
    const t = setup();
    await addProject(t, api, "legacy-mainframes");
    const result = await callTool(t, "send_task", { request: "  " });
    expect(result.isError).toBe(true);
    expect(await allTasks(t)).toHaveLength(0);
  });
});

describe("choosing the project", () => {
  test("with no projects it says how to add one", async () => {
    const t = setup();
    const result = await callTool(t, "send_task", { request: "sweep" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("npx convex run projects:add");
    expect(api.fires).toHaveLength(0);
  });

  test("with no default and no project named it asks which one", async () => {
    const t = setup();
    await addProject(t, api, "legacy-mainframes", { makeDefault: false });
    await addProject(t, api, "legacy-monolith", { makeDefault: false });
    const result = await callTool(t, "send_task", { request: "sweep" });
    expect(result.text).toContain("Which project? There is no default project. Projects: Legacy Mainframes, Legacy Monolith.");
    expect(await allTasks(t)).toHaveLength(0);
  });

  test("an ambiguous name lists the candidates so the assistant can ask", async () => {
    const t = setup();
    await addProject(t, api, "legacy-mainframes");
    await addProject(t, api, "legacy-monolith");
    const result = await callTool(t, "send_task", { request: "sweep", project: "legacy" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('"legacy" could mean Legacy Mainframes or Legacy Monolith.');
    expect(result.text).toContain("ask the user which one");
    expect(api.fires).toHaveLength(0);
  });

  test("an unknown name lists the projects", async () => {
    const t = setup();
    await addProject(t, api, "legacy-mainframes");
    const result = await callTool(t, "send_task", { request: "sweep", project: "payroll" });
    expect(result.text).toBe('There is no project called "payroll". Projects: Legacy Mainframes (default).');
  });

  test("list_projects marks the default", async () => {
    const t = setup();
    expect((await callTool(t, "list_projects")).text).toContain("No projects are set up yet.");
    await addProject(t, api, "legacy-mainframes");
    await addProject(t, api, "legacy-monolith");
    expect((await callTool(t, "list_projects")).text).toBe("Projects: Legacy Mainframes (default), Legacy Monolith.");
  });
});

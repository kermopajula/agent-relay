export const TOOL_NAMES = ["send_to_claude", "wait_for_task", "task_status", "list_tasks"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(name: unknown): name is ToolName {
  return typeof name === "string" && (TOOL_NAMES as readonly string[]).includes(name);
}

const nameArgument = {
  type: "string",
  description: 'The task name returned by send_to_claude, for example "Test task 3". Use "last" for the most recent task.',
};

export function serverInstructions(waitSeconds: number): string {
  return (
    "This is a test connector for sending tasks to the user's Claude Code assistant. " +
    "Tasks are fake and finish on a timer after 2, 10 or 30 minutes. " +
    "When the user asks to be told when a task is done, call send_to_claude, then call wait_for_task " +
    `with the returned name. Each wait_for_task call waits up to about ${waitSeconds} seconds. ` +
    "Keep calling wait_for_task until it says the task is done, then tell the user the result out loud."
  );
}

export function toolDefinitions(waitSeconds: number) {
  return [
    {
      name: "send_to_claude",
      title: "Send a task to Claude",
      description:
        "Send a task to the user's Claude Code assistant and start it. " +
        "This is a test connector: no real work happens, and the task finishes on a timer. " +
        'Say "2 minute", "10 minute" or "30 minute" in the task text to choose how long it takes; otherwise it picks one. ' +
        "Returns the task name. IMPORTANT: if the user asked to be told when the task is done, " +
        "call wait_for_task with the returned name straight away, and call wait_for_task again every time " +
        "it says the task is still running, until it says the task is done. Then tell the user the result. " +
        "Do not ask the user whether to keep waiting.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "What the user wants Claude to do, in their own words." },
        },
        required: ["task"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "wait_for_task",
      title: "Wait for a task to finish",
      description:
        "Wait for a task started with send_to_claude to finish. " +
        `Each call waits up to about ${waitSeconds} seconds, then returns. ` +
        "If the result says the task is still running, call wait_for_task again straight away with the same name. " +
        "Keep repeating until the result says the task is done, then tell the user the result out loud. " +
        "Use this whenever the user asked to be told when a task is done.",
      inputSchema: {
        type: "object",
        properties: { name: nameArgument },
        required: ["name"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "task_status",
      title: "Check a task now",
      description:
        "Get the status of a task right now, without waiting. Use this when the user asks how a task is going. " +
        "To wait until a task is done, use wait_for_task instead.",
      inputSchema: {
        type: "object",
        properties: { name: nameArgument },
        required: ["name"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "list_tasks",
      title: "List recent tasks",
      description:
        "List the most recent tasks sent to Claude and their status, one short line each, ready to read aloud.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
  ];
}

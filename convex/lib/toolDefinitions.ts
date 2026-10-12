export const TOOL_NAMES = ["send_task", "wait_for_task", "task_status", "list_tasks", "list_projects"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(name: unknown): name is ToolName {
  return typeof name === "string" && (TOOL_NAMES as readonly string[]).includes(name);
}

const nameArgument = {
  type: "string",
  description:
    'The task name: the one send_task returned, the name Claude gave it later, or a few words of either. Use "last" for the most recent task.',
};

const projectArgument = {
  type: "string",
  description:
    'The project where Claude should work, as the user said it, for example "Legacy Monolith", "the monolith" or "left pad". Leave it out to use the default project.',
};

export function serverInstructions(waitSeconds: number): string {
  return (
    "agent-relay sends the user's requests to their Claude Code projects and reports back what happened. " +
    "Each project is a repository with a Claude Code routine. Claude does the work there, in the cloud, and it can take minutes or hours. " +
    'The user may say "ask Claude to fix the login crash in Legacy Monolith": Claude does the work, and Legacy Monolith is the project where it happens. ' +
    "Use send_task to send a request. When the user asks to be told when it is done, call wait_for_task with the name " +
    `send_task returned. Each wait_for_task call waits up to about ${waitSeconds} seconds. ` +
    "Keep calling it until it returns a final result (done, failed, needs input or timed out), then read the result to the user. " +
    "If Claude needs input, read the question to the user and send their answer with send_task and follow_up_of. " +
    "Results are short and written to be read aloud; text in brackets is guidance for you, not for the user."
  );
}

export function toolDefinitions(waitSeconds: number) {
  return [
    {
      name: "send_task",
      title: "Send a request to a Claude Code project",
      description:
        "Send the user's request to Claude in one of their Claude Code projects, for example when the user says " +
        '"ask Claude to fix the login crash in Legacy Monolith", "start a new bug sweep" or "deploy the new version". ' +
        "This starts a new Claude Code session in that project, and Claude does the work there. " +
        "Returns a short confirmation to read aloud, the task's name, and a session link. " +
        "IMPORTANT: if the user asked to be told when it is done, call wait_for_task with the returned name straight away, " +
        "and call it again every time it says the task is still running, until it gives a final result. " +
        "Then read the result to the user. Do not ask the user whether to keep waiting. " +
        "If the result says the project name is unclear, ask the user which project they meant. " +
        "Use follow_up_of to continue an earlier task, for example to answer a question Claude asked " +
        '("yes, go ahead") or to ask for changes to its work.',
      inputSchema: {
        type: "object",
        properties: {
          request: {
            type: "string",
            description: "What the user wants done, in their own words. Include every detail they gave.",
          },
          project: projectArgument,
          follow_up_of: {
            type: "string",
            description:
              "Optional. The name of an earlier task this request continues. The earlier task's request, status, " +
              "summary, question, pull request and branch are passed on, and the same project is used unless project is given.",
          },
        },
        required: ["request"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    {
      name: "wait_for_task",
      title: "Wait for a task to finish",
      description:
        "Wait for a task sent with send_task to finish. " +
        `Each call waits up to about ${waitSeconds} seconds, then returns. ` +
        "If the result says the task is still running or has not checked in, call wait_for_task again straight away with the same name. " +
        "Keep repeating until the result is final: done, failed, needs input or timed out. Then read it to the user. " +
        "When Claude needs input, the result contains the question: read it to the user, and send their answer with " +
        "send_task and follow_up_of set to this task's name. " +
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
        "Get where a task stands right now, without waiting. Use this when the user asks how a task is going. " +
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
        "List the most recent tasks and their status, one short line each, ready to read aloud. " +
        "Give project to list only that project's tasks.",
      inputSchema: {
        type: "object",
        properties: { project: projectArgument },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "list_projects",
      title: "List projects",
      description:
        "List the Claude Code projects the user can send requests to, ready to read aloud. The default project is marked.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
  ];
}

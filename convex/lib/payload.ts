import { MAX_NAME, MAX_SUMMARY } from "./report";

export type FollowUpContext = {
  request: string;
  name: string;
  status: string;
  summary?: string;
  question?: string;
  prUrl?: string;
  branch?: string;
  sessionUrl?: string;
};

export type PayloadInput = {
  request: string;
  projectDisplayName: string;
  taskId: string;
  reportUrl: string;
  reportSecret: string;
  followUp?: FollowUpContext;
};

function followUpBlock(f: FollowUpContext): string[] {
  const lines = [
    "Follow-up context",
    "This request continues an earlier relay task. Continue the same work: reuse its branch and pull request if it has them.",
    `Earlier request: ${f.request}`,
    `Earlier task name: ${f.name}`,
    `Earlier status: ${f.status}`,
  ];
  if (f.summary) lines.push(`Earlier summary: ${f.summary}`);
  if (f.question) lines.push(`Question you asked: ${f.question}`);
  if (f.prUrl) lines.push(`Pull request: ${f.prUrl}`);
  if (f.branch) lines.push(`Branch: ${f.branch}`);
  if (f.sessionUrl) lines.push(`Earlier session: ${f.sessionUrl}`);
  if (f.question) {
    lines.push("If the request above answers the question with a yes, do exactly what the question described.");
  }
  return lines;
}

/** The `text` sent to the routine: the request, any follow-up context, and how to report back. */
export function buildPayload(input: PayloadInput): string {
  const { reportUrl, reportSecret } = input;
  const curl = (json: string) =>
    [
      `curl -sS -X POST '${reportUrl}' \\`,
      `  -H 'Authorization: Bearer ${reportSecret}' \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  --data-binary @- <<'JSON'`,
      json,
      "JSON",
    ].join("\n");

  const sections = [
    [`Request for the ${input.projectDisplayName} project, sent by the owner through agent-relay:`, input.request],
    input.followUp ? followUpBlock(input.followUp) : null,
    [
      "Relay reporting",
      "The owner follows this task through the relay, often by voice. Report to it with HTTP POST requests.",
      `Task id: ${input.taskId}`,
      `Report URL: ${reportUrl}`,
      `Report secret: ${reportSecret}`,
      `Send the secret as the header "Authorization: Bearer ${reportSecret}". Never write the secret into files, commits or pull requests.`,
      "",
      "The body is a JSON object with these fields:",
      '- status (required): "running", "done", "failed" or "needs_input".',
      `- name (optional): a short task name, at most ${MAX_NAME} characters. Send it with the first report.`,
      `- summary (optional): at most ${MAX_SUMMARY} characters. For a final report, at most three sentences written to be read aloud.`,
      `- question (required with needs_input): exactly what you want to do and need the owner to confirm, at most ${MAX_SUMMARY} characters.`,
      "- pr_url (optional): the https link of the pull request.",
      "- branch (optional): the branch name.",
      "Leave out fields you have no value for. Any other field is an error.",
      "",
      "Order: first report running with a name, then one final report: done, failed or needs_input.",
      "After a final report the relay accepts no more reports for this task. Always send the final report, even when the work fails.",
      "",
      "Start report:",
      curl('{"status": "running", "name": "Fix login crash"}'),
      "",
      "Final report:",
      curl(
        '{"status": "done", "summary": "Fixed the login crash. Draft PR 412 is ready.", "pr_url": "https://github.com/owner/repo/pull/412", "branch": "fix/login-crash"}',
      ),
      "",
      "Asking before something hard to undo:",
      curl('{"status": "needs_input", "question": "Deploy version 2.4.0 to production now?"}'),
      "",
      "The relay answers 200 when it accepts a report, 400 with a reason when the body is wrong, and 409 after a final report.",
    ],
  ];
  return sections
    .filter((section): section is string[] => section !== null)
    .map((section) => section.join("\n"))
    .join("\n\n");
}

# agent-relay

agent-relay is a small relay that you host on your own free Convex deployment. It lets a voice or chat assistant send requests to your Claude Code projects and read back what happened. You say "ask Begin Mobile to fix the login crash", the relay starts a Claude Code session in that project, Claude reports its progress back to the relay, and your assistant reads the result to you. It works with Grok Bot (in the Grok apps and in a Tesla) and with any MCP client that supports custom connectors, on one side, and with Claude Code routines on the other. One deployment serves one owner.

An example, in the car:

> **You:** Ask Begin Mobile to fix the login crash and tell me when it's done.
>
> **Grok:** Sent to Begin Mobile. I'll know its name in about a minute.
>
> *(twelve minutes later)*
>
> **Grok:** Begin Mobile finished Fix login crash. Draft PR 412 is ready.

agent-relay is not affiliated with xAI or Anthropic.

## How it works

1. Your assistant calls the relay's `send_task` tool with your request and, if you named one, a project.
2. The relay picks the project and fires that project's Claude Code routine through the routine's API trigger. The request travels as the routine's payload, together with a report URL and a secret that only this task knows.
3. The routine starts a new Claude Code session in your project. Claude reads the request and does the work with the project's instructions, memory and repositories.
4. Claude reports back to the relay over HTTP: first `running` with a short task name, then `done`, `failed` or `needs_input` with a summary, a question or a pull request link.
5. Your assistant calls `wait_for_task` until the task is final, then reads the result out loud.

```
 you ── voice ──> assistant ── MCP ──> agent-relay ── fire ──> routine
                      ^                 (Convex)                  │
                      │                    ^                      v
                      └─ wait_for_task ────┘<── reports ── Claude Code session
                                                            in your project
```

Each project is one general-purpose "inbox" routine, for example "Begin Bugs" or "Begin Mobile". The request text decides what happens: "start a new bug sweep", "fix the login crash" or "deploy the new version".

## Requirements

- A Claude plan with Claude Code routines: Pro, Max, Team or Enterprise.
- An MCP assistant that supports custom connectors with a bearer token header. For Grok this means a paid plan with connectors.
- A free Convex account.
- Node 20 or later.

## Setup

Deploy the relay:

```sh
git clone https://github.com/kermopajula/agent-relay.git
cd agent-relay
npm install
npx convex login
npx convex dev --once --configure=new   # creates a free project; pick any name
npx convex deploy                        # pushes to the project's production deployment
```

Set the two secrets on the production deployment:

```sh
openssl rand -hex 32      # copy the output: this is your CONNECTOR_SECRET
npx convex env set CONNECTOR_SECRET <CONNECTOR_SECRET> --prod
openssl rand -base64 32   # copy the output: this key encrypts routine tokens
npx convex env set TOKEN_ENCRYPTION_KEY <KEY> --prod
```

Keep a copy of `TOKEN_ENCRYPTION_KEY`. If it changes, the stored routine tokens can no longer be read, and you must store each one again with `projects:rotateToken`.

Find the relay's URL: run `npx convex dashboard --prod`, open Settings, and copy the "HTTP Actions URL". It ends in `.convex.site`, not `.convex.cloud`. Below it is called `https://<deployment>.convex.site`.

Check that it answers. You should see `{"jsonrpc":"2.0","id":1,"result":{}}`:

```sh
curl -X POST https://<deployment>.convex.site/mcp \
  -H "Authorization: Bearer <CONNECTOR_SECRET>" \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'
```

## Add a project

A project is one Claude Code routine with an API trigger. Create it on claude.ai:

1. **Create the routine.** Ideally create it from inside a Claude Project, so each run starts as a new thread in that project with its instructions and memory. Name it after the project, for example "Begin Mobile".
2. **Paste the prompt.** Use the text in [docs/inbox-routine-prompt.md](docs/inbox-routine-prompt.md). It tells Claude to act on the request in the payload, to report back, and to ask before anything hard to undo.
3. **Pick the repositories** the project works on.
4. **Remove connectors it does not need.** Every connector is something a request can reach. A bug-fixing routine rarely needs your mail or calendar, so leave them out.
5. **Allow the relay's domain.** In the routine's cloud environment, open the network settings and add `<deployment>.convex.site` to the allowed domains. Without it, Claude's report requests are blocked and the relay never hears back.
6. **Add an API trigger.** Copy the fire URL and the token. The token is shown once.

Then add the project to the relay:

```sh
npx convex run projects:add '{
  "name": "begin-mobile",
  "displayName": "Begin Mobile",
  "aliases": ["mobile", "the app"],
  "fireUrl": "https://api.anthropic.com/v1/claude_code/routines/trig_.../fire",
  "token": "sk-ant-oat01-..."
}' --prod
```

`name` is a lowercase slug. `displayName` and `aliases` are optional; the display name defaults to the slug in title case. The first project becomes the default; pass `"makeDefault": true` to make a later one the default. The command line holds the token, so clear it from your shell history afterwards.

Other project commands, each with `--prod`:

| Command | What it does |
| --- | --- |
| `npx convex run projects:list` | Lists projects. Tokens are never shown. |
| `npx convex run projects:setDefault '{"name":"begin-bugs"}'` | Makes a project the default. |
| `npx convex run projects:rotateToken '{"name":"begin-bugs","token":"sk-ant-oat01-..."}'` | Stores a new token. |
| `npx convex run projects:remove '{"name":"begin-bugs"}'` | Removes a project. Its past tasks stay in the log. |

These functions are internal: only someone with your Convex deploy access can call them.

## Connect your assistant

In Grok:

1. Open grok.com/connectors.
2. Choose New Connector, then Custom.
3. Enter the URL `https://<deployment>.convex.site/mcp`.
4. For authentication, choose a bearer token and paste `CONNECTOR_SECRET` into the masked field. If Grok asks for the full header value, enter `Bearer <CONNECTOR_SECRET>`.

Other MCP clients: add a Streamable HTTP server at `https://<deployment>.convex.site/mcp` with the header `Authorization: Bearer <CONNECTOR_SECRET>`. A client that cannot send headers can use `https://<deployment>.convex.site/mcp/<CONNECTOR_SECRET>` instead, but then the secret sits in the URL in plain text.

## Using it

Things you can say:

- "Ask Begin Bugs to start a new bug sweep."
- "Ask Begin Mobile to fix the login crash and tell me when it's done."
- "Tell the bug project to look at yesterday's crash reports." (a loose project name works)
- "Is the login crash task done?"
- "What are my Begin Mobile tasks?"
- "Which projects do I have?"
- When Claude asks first, for example "Deploy version 2.4.0 to production now?": "Yes, go ahead." The assistant sends this as a follow-up of the earlier task, so the new session continues the same work.

Until Claude names a task, it is called "new Begin Mobile task, sent 10:05". That name keeps working after Claude renames it. Duplicate names get " (2)", " (3)" and so on.

| Tool | What it does |
| --- | --- |
| `send_task(request, project?, follow_up_of?)` | Sends a request to a project (the default if none is named) and returns the task name and the session link. `follow_up_of` passes an earlier task's request, status, summary, question, pull request and branch to the new session. An unclear project name returns the candidates, so the assistant can ask you. |
| `wait_for_task(name)` | Waits up to `WAIT_SECONDS` for a final result: done, failed, needs input or timed out. Otherwise it says the task is still running, and the assistant calls it again. |
| `task_status(name)` | Says where a task stands, at once. |
| `list_tasks(project?)` | One short line per recent task. |
| `list_projects()` | The project names, with the default marked. |

## Safety

- **Claude asks before anything hard to undo.** The routine prompt tells Claude to report `needs_input` instead of deploying, releasing, merging, deleting, messaging people or spending money. You confirm with a follow-up, and only then does a new session do it.
- **Who can start your routines.** Only callers with `CONNECTOR_SECRET` reach the MCP tools; any other request gets a plain 404. The routine tokens stay in your deployment, encrypted with AES-GCM under `TOKEN_ENCRYPTION_KEY`, and no tool, log or command returns them. To lock everyone out, set a new `CONNECTOR_SECRET`.
- **What a request can do.** A request can do whatever the routine's prompt, repositories and connectors allow, and no more. Anthropic's rate limits cap how often routines start.
- **Reports are per task.** Each task has its own random report secret. The relay stores only its SHA-256 hash, so one session cannot report on another session's task.
- **Keep connectors minimal per project.** Each routine gets only the repositories and connectors its project needs.
- **Untrusted content stays data.** The routine prompt tells Claude to treat instructions found in files, issues and web pages as data, not commands.

## Troubleshooting

- **"Claude hasn't checked in yet."** No report arrived within 15 minutes of the start. Open the session link. The usual cause is that `<deployment>.convex.site` is missing from the allowed domains in the routine environment's network settings, so Claude's curl requests are blocked.
- **"The token for Begin Mobile was rejected."** The routine API answered 401. Create a new token on the routine's API trigger and store it with `projects:rotateToken`.
- **"Rate limited by Anthropic; try again later."** The routine API answered 429. Each routine accepts 30 API starts per hour, and each account 100.
- **The assistant stops waiting or reports a tool timeout.** Lower `WAIT_SECONDS`, for example to 25, so each `wait_for_task` call returns sooner.
- **Reading the log.** Open `https://<deployment>.convex.site/log/<CONNECTOR_SECRET>?format=text&tz=Europe/Tallinn`. For each task it shows the project, the request, the status history with times, every report, every assistant call with the gap since the previous one, and whether the final result reached the assistant. Without `format=text` you get the same data as JSON, newest first, with the last 500 requests.

## Configuration

Set each value with `npx convex env set NAME value --prod`.

| Variable | Default | What it does |
| --- | --- | --- |
| `CONNECTOR_SECRET` | none, required | The bearer token your assistant sends. At least 16 characters. |
| `TOKEN_ENCRYPTION_KEY` | none, required | 32 random bytes in base64 (`openssl rand -base64 32`). Encrypts routine tokens. |
| `WAIT_SECONDS` | 50 | How long one `wait_for_task` call holds, from 0 to 120. |
| `TASK_TIMEOUT_HOURS` | 6 | Hours without a final report before a task counts as timed out. A late report still counts. |
| `DISPLAY_TIMEZONE` | UTC | Time zone for task names and spoken times, for example `Europe/Tallinn`. Also the log's default. |
| `ALLOWED_ORIGINS` | unset | A comma-separated list. When set, an MCP request with any other `Origin` header gets 403. |

## Limits

- The routine API trigger is a research preview. Its URL, headers or limits can change; the relay keeps that call in one module, `convex/lib/routineApi.ts`.
- Anthropic limits routine starts to 30 per hour per routine and 100 per hour per account.
- Each request starts a new session. A follow-up continues the same work through the context the relay passes on, not in the same session.
- Assistants decide for themselves how long to keep calling `wait_for_task`. The Grok app kept waiting through tasks of 2 and 10 minutes in testing. For longer work, ask "is it done?" later.

## Development

```sh
npm run typecheck
npm test
```

Tests use `convex-test` and Vitest with fake timers and a strict fake of the routine API, so they run in a few seconds and make no network calls. `npx convex dev` runs the code on a deployment while you edit.

## License

MIT

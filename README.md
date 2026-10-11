# Grok Bot to Claude bridge: test connector

This is a throwaway test, not the bridge. It is a fake MCP connector that answers three questions in a real car before we build anything:

1. Does Grok Bot accept a custom MCP connector added by URL?
2. When you say "...and tell me when it's done", does Grok Bot keep checking a long task and announce the result by voice?
3. How long does it keep waiting: 2, 10 or 30 minutes?

Nothing calls Claude. Each task is fake and finishes on a timer. Every request Grok makes is logged, and the log is the test result.

This project is not affiliated with xAI or Anthropic.

## How it works

One Convex deployment hosts everything:

- `POST /mcp/<SECRET>`: a minimal MCP server (Streamable HTTP, JSON responses, no streaming, no sessions). It answers the `initialize` handshake of protocol versions 2025-03-26, 2025-06-18 and 2025-11-25, and the per-request metadata of 2026-07-28.
- `GET /log/<SECRET>`: every logged request plus a per-task summary.

Tools:

| Tool | What it does |
| --- | --- |
| `send_to_claude(task)` | Starts a fake task. Say "2 minute", "10 minute" or "30 minute" to pick the length; otherwise tasks cycle 2, 10, 30 by task number. Returns a name such as "Test task 3". |
| `wait_for_task(name)` | Holds for up to `WAIT_SECONDS` (default 50), then says "done" or "still running, about N minutes left; call again". |
| `task_status(name)` | Answers at once. |
| `list_tasks()` | One spoken line per recent task. |

`name` may be the exact name, "task 3", or "last" for the newest task.

## Deploy

You need Node 20 or later and a free Convex account.

```sh
npm install
npx convex login
npx convex dev --once --configure=new   # creates a free project; pick any name
npx convex deploy                        # pushes to the project's production deployment
openssl rand -hex 32                     # copy the output: this is your SECRET
npx convex env set CONNECTOR_SECRET <SECRET> --prod
```

Find the HTTP URL: `npx convex dashboard --prod`, then Settings, then "HTTP Actions URL". It ends in `.convex.site` (not `.convex.cloud`).

Check it works (expect `{"jsonrpc":"2.0","id":1,"result":{}}`):

```sh
curl -X POST https://<deployment>.convex.site/mcp/<SECRET> \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'
```

Optional settings, each with `npx convex env set NAME value --prod`:

- `WAIT_SECONDS`: how long one `wait_for_task` call holds. Default 50, range 0 to 120. Lower it if Grok reports tool timeouts.
- `ALLOWED_ORIGINS`: comma-separated list. When set, a request with any other `Origin` header gets 403. Unset by default, because we do not know what Grok sends.

## Why the secret is in the URL

We do not yet know which auth methods Grok custom connectors support. A long random secret in the path works with any client and does not start an OAuth flow. A wrong or missing secret gets a plain 404, so the endpoint does not reveal itself.

The trade-off: anyone who sees the URL can use the connector. The URL may appear in xAI's systems, in proxy logs and in Convex request logs. This is acceptable only because the tools are fake and hold no data. The real bridge needs proper auth (OAuth or a bearer token). To revoke access, set a new `CONNECTOR_SECRET`.

## Add the connector in Grok

1. Open grok.com/connectors.
2. Choose New Connector, then Custom.
3. Enter the URL `https://<deployment>.convex.site/mcp/<SECRET>`.
4. Choose no authentication if Grok asks.

Write down whether Grok accepted it and any error text. Open `/log/<SECRET>` straight away: an `initialize` and a `tools/list` request should appear.

## Car test script

Run each phrase in a separate conversation and wait without speaking until Grok speaks or clearly gives up.

1. "Ask Claude to run a 2 minute test task and tell me when it's done."
2. "Ask Claude to run a 10 minute test task and tell me when it's done."
3. "Ask Claude to run a 30 minute test task and tell me when it's done."

If Grok stops on its own, you can ask "Is my Claude task done?" to test `task_status`, but write down that you prompted it.

## Read the log

- Summary as plain text: `https://<deployment>.convex.site/log/<SECRET>?format=text&tz=Europe/Tallinn`
- Full JSON (newest first, last 500 requests): `https://<deployment>.convex.site/log/<SECRET>`

For each task the summary shows when it was created, every `wait_for_task` and `task_status` call, the gap since the previous reply, how long each call was held, the last call, and whether Grok ever received the final result. "Final result delivered to Grok: NO" with "stopped checking after X" is the answer to question 3.

The "Clients seen" block shows the client name, protocol version and user agent Grok reported.

## What to write down

For each phrase:

- Date, start time, and where you ran it (Tesla model and software version, or Grok app and platform).
- Whether Grok called the connector at all, and whether it asked you to confirm.
- What Grok said right after starting the task.
- Whether Grok announced the result by voice, and when.
- Anything that interrupted it: driving away, the screen sleeping, another question.
- A copy of the `?format=text` summary after the test.

## Develop

```sh
npm run typecheck
npm test
```

Tests use `convex-test` and Vitest with fake timers, so they run in about a second. `npx convex dev` runs the code on a deployment while you edit.

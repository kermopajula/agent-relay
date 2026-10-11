import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { sha256Hex } from "./lib/crypto";
import { notFound, truncate } from "./lib/http";
import { parseReport } from "./lib/report";
import { secretFromBearer, secretFromPath } from "./lib/secret";

const MAX_BODY = 10_000;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** `POST /report/<taskId>` with `Authorization: Bearer <report secret>`, called by the routine's session. */
export async function handleReport(ctx: ActionCtx, req: Request): Promise<Response> {
  const started = Date.now();
  const taskId = secretFromPath(new URL(req.url).pathname, "report");
  const secret = secretFromBearer(req.headers.get("authorization"));
  if (taskId === null || secret === null) return notFound();

  const raw = await req.text();
  let parsed: ReturnType<typeof parseReport>;
  if (raw.length > MAX_BODY) {
    parsed = { ok: false, message: `The body must be at most ${MAX_BODY} characters.` };
  } else {
    try {
      parsed = parseReport(JSON.parse(raw));
    } catch {
      parsed = { ok: false, message: "The body must be JSON." };
    }
  }

  const outcome = await ctx.runMutation(internal.tasks.applyReport, {
    taskId,
    secretHash: await sha256Hex(secret),
    report: parsed.ok ? parsed.report : undefined,
    invalid: parsed.ok ? undefined : parsed.message,
  });
  if (outcome.httpStatus === 404) return notFound();

  try {
    // The body holds no secret; the Authorization header is never stored.
    await ctx.runMutation(internal.calls.record, {
      at: started,
      durationMs: Date.now() - started,
      httpMethod: req.method,
      httpStatus: outcome.httpStatus,
      args: truncate(raw, 2000),
      responseSummary: outcome.message,
      era: "none",
      endpoint: "report",
      taskId: outcome.taskId,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
  } catch (error) {
    console.error("Failed to record report", error);
  }

  if (outcome.httpStatus === 200) return reply(200, { ok: true, name: outcome.name, status: outcome.status });
  return reply(outcome.httpStatus, { ok: false, error: outcome.message, status: outcome.status });
}

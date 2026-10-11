import { internal } from "./_generated/api";
import { env, type ActionCtx } from "./_generated/server";
import { notFound } from "./lib/http";
import { isAuthorized } from "./lib/secret";
import { buildSummary } from "./lib/summary";

function validTimeZone(tz: string | null): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export async function handleLog(ctx: ActionCtx, req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (!(await isAuthorized(url.pathname, "log", env.CONNECTOR_SECRET))) return notFound();

  const data = await ctx.runQuery(internal.calls.logData, {});
  const tz = validTimeZone(url.searchParams.get("tz"));
  const summary = buildSummary(data.tasks, data.calls, Date.now(), tz);

  if (url.searchParams.get("format") === "text") {
    return new Response(summary, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const body = {
    summary,
    tasks: data.tasks.map(({ task }) => task),
    calls: data.calls,
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

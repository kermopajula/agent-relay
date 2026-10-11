import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, type ActionCtx } from "./_generated/server";
import { originAllowed, waitSeconds } from "./lib/config";
import { empty, json, notFound, truncate } from "./lib/http";
import {
  ERROR,
  SUPPORTED_VERSIONS,
  classify,
  clientDetails,
  eraOf,
  hasClientCapabilities,
  headerMismatch,
  isRecord,
  metaVersion,
  negotiateLegacyVersion,
  result,
  rpcError,
  SERVER_INFO,
  type ClientDetails,
  type Era,
  type Params,
  type RpcId,
} from "./lib/protocol";
import { authMethod, secretFromPath, type AuthMethod } from "./lib/secret";
import { isToolName, serverInstructions, toolDefinitions } from "./lib/toolDefinitions";
import { runTool } from "./toolRunner";

type CallLog = {
  rpcMethod?: string;
  rpcId?: string;
  tool?: string;
  args?: string;
  responseSummary: string;
  era: Era | "none";
  taskId?: Id<"tasks">;
  finalDelivered?: boolean;
} & ClientDetails;

type Gate = { blocked: Response; auth?: undefined } | { blocked?: undefined; auth: AuthMethod };

type Outcome = { response: Response; log: CallLog };

const CAPABILITIES = { tools: { listChanged: false } };

async function record(
  ctx: ActionCtx,
  req: Request,
  auth: AuthMethod,
  started: number,
  status: number,
  log: CallLog,
) {
  try {
    // Only the method is stored, never the secret or the Authorization header.
    await ctx.runMutation(internal.calls.record, {
      ...log,
      auth,
      endpoint: "mcp",
      at: started,
      durationMs: Date.now() - started,
      httpMethod: req.method,
      httpStatus: status,
      userAgent: req.headers.get("user-agent") ?? undefined,
      origin: req.headers.get("origin") ?? undefined,
    });
  } catch (error) {
    // Logging must never break the MCP response the client is waiting for.
    console.error("Failed to record call", error);
  }
}

/**
 * Shared gate for every MCP route: wrong secret looks like a missing page.
 * It answers 404, never 401: a 401 with WWW-Authenticate can make MCP clients
 * start OAuth discovery, which this server does not support.
 */
async function gate(req: Request): Promise<Gate> {
  const { pathname } = new URL(req.url);
  const auth = await authMethod(pathname, "mcp", req.headers.get("authorization"), env.CONNECTOR_SECRET);
  if (auth === null) return { blocked: notFound() };
  if (!originAllowed(req.headers.get("origin"), env.ALLOWED_ORIGINS)) {
    return { blocked: json(403, rpcError(null, ERROR.invalidRequest, "Origin not allowed")) };
  }
  return { auth };
}

async function callTool(ctx: ActionCtx, id: RpcId, era: Era, params: Params, base: CallLog): Promise<Outcome> {
  const tool = params.name;
  const args = isRecord(params.arguments) ? params.arguments : {};
  const log: CallLog = {
    ...base,
    tool: typeof tool === "string" ? tool : undefined,
    args: truncate(JSON.stringify(args), 2000),
  };
  if (!isToolName(tool)) {
    const message = `Unknown tool: ${String(tool)}`;
    return { response: json(200, rpcError(id, ERROR.invalidParams, message)), log: { ...log, responseSummary: message } };
  }
  const waitMs = waitSeconds(env.WAIT_SECONDS) * 1000;
  const outcome = await runTool(ctx, tool, args, waitMs);
  const payload = { content: [{ type: "text", text: outcome.text }], isError: outcome.isError };
  return {
    response: json(200, result(id, era, payload)),
    log: {
      ...log,
      responseSummary: truncate(outcome.text, 300),
      taskId: outcome.taskId,
      finalDelivered: outcome.finalDelivered,
    },
  };
}

async function handleRequest(
  ctx: ActionCtx,
  req: Request,
  id: RpcId,
  method: string,
  params: Params,
): Promise<Outcome> {
  const era = eraOf(method, params);
  const base: CallLog = {
    rpcMethod: method,
    rpcId: String(id),
    era,
    responseSummary: "",
    ...clientDetails(method, params, req.headers.get("mcp-protocol-version")),
  };
  const fail = (status: number, code: number, message: string, data?: unknown): Outcome => ({
    response: json(status, rpcError(id, code, message, data)),
    log: { ...base, responseSummary: `error ${code}: ${message}` },
  });

  const requested = era === "modern" ? metaVersion(params) : req.headers.get("mcp-protocol-version");
  if (requested && method !== "initialize" && !SUPPORTED_VERSIONS.includes(requested)) {
    return fail(400, ERROR.unsupportedVersion, "Unsupported protocol version", {
      supported: SUPPORTED_VERSIONS,
      requested,
    });
  }
  if (era === "modern") {
    const mismatch = headerMismatch(req.headers, method, params);
    if (mismatch) return fail(400, ERROR.headerMismatch, `Header mismatch: ${mismatch}`);
    if (!hasClientCapabilities(params)) {
      return fail(400, ERROR.invalidParams, "Missing _meta io.modelcontextprotocol/clientCapabilities");
    }
  }

  const waitSecs = waitSeconds(env.WAIT_SECONDS);
  const ok = (payload: Record<string, unknown>, summary: string): Outcome => ({
    response: json(200, result(id, era, payload)),
    log: { ...base, responseSummary: summary },
  });

  switch (method) {
    case "initialize": {
      const protocolVersion = negotiateLegacyVersion(params.protocolVersion);
      return ok(
        { protocolVersion, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: serverInstructions(waitSecs) },
        `initialize ok, answered protocol ${protocolVersion}`,
      );
    }
    case "server/discover":
      return ok(
        { supportedVersions: SUPPORTED_VERSIONS, capabilities: CAPABILITIES, instructions: serverInstructions(waitSecs) },
        "server/discover ok",
      );
    case "ping":
      return ok({}, "pong");
    case "tools/list": {
      const tools = toolDefinitions(waitSecs);
      return ok({ tools }, `tools/list: ${tools.length} tools`);
    }
    case "tools/call":
      return callTool(ctx, id, era, params, base);
    default:
      // The modern transport signals an unknown method with 404 as well as -32601.
      return fail(era === "modern" ? 404 : 200, ERROR.methodNotFound, `Method not found: ${method}`);
  }
}

export async function handlePost(ctx: ActionCtx, req: Request): Promise<Response> {
  const { blocked, auth } = await gate(req);
  if (blocked) return blocked;
  const started = Date.now();

  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    const response = json(400, rpcError(null, ERROR.parse, "Parse error"));
    await record(ctx, req, auth, started, 400, { era: "none", responseSummary: "parse error" });
    return response;
  }

  const message = classify(body);
  let outcome: Outcome;
  switch (message.kind) {
    case "invalid":
      outcome = {
        response: json(400, rpcError(message.id, ERROR.invalidRequest, message.message)),
        log: { era: "none", responseSummary: `invalid: ${message.message}` },
      };
      break;
    case "response":
      outcome = { response: empty(202), log: { era: "none", responseSummary: "client response ignored" } };
      break;
    case "notification":
      outcome = {
        response: empty(202),
        log: {
          rpcMethod: message.method,
          era: eraOf(message.method, message.params),
          responseSummary: "accepted",
          ...clientDetails(message.method, message.params, req.headers.get("mcp-protocol-version")),
        },
      };
      break;
    case "request":
      outcome = await handleRequest(ctx, req, message.id, message.method, message.params);
      break;
  }
  await record(ctx, req, auth, started, outcome.response.status, outcome.log);
  return outcome.response;
}

/** GET (legacy SSE stream) and DELETE (legacy session end) are not offered. */
export async function handleNotAllowed(ctx: ActionCtx, req: Request): Promise<Response> {
  const { blocked, auth } = await gate(req);
  if (blocked) return blocked;
  const started = Date.now();
  await record(ctx, req, auth, started, 405, { era: "none", responseSummary: `${req.method} not allowed` });
  return empty(405, { Allow: "POST, OPTIONS" });
}

export async function handleOptions(req: Request): Promise<Response> {
  // A browser preflight never carries the Authorization header, so the bare
  // header-auth path answers it without a credential. It reveals nothing else.
  if (secretFromPath(new URL(req.url).pathname, "mcp") === null) return empty(204);
  const { blocked } = await gate(req);
  return blocked ?? empty(204);
}

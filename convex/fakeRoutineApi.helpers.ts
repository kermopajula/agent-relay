import { vi } from "vitest";

// A strict stand-in for the routine fire API, copied from Anthropic's docs
// (code.claude.com/docs/en/routines). Any request that does not match the
// documented shape is recorded in `unexpected` and fails the test.

export const FIRE_PREFIX = "https://api.anthropic.com/v1/claude_code/routines/";

export type FireOutcome = "ok" | 401 | 429 | 500 | "network";

export type Fire = { routineId: string; token: string; text: string };

const EXPECTED_HEADERS = ["anthropic-beta", "anthropic-version", "authorization", "content-type"];

export function fireUrl(routineId: string): string {
  return `${FIRE_PREFIX}${routineId}/fire`;
}

export function sessionId(n: number): string {
  return `session_01TEST${String(n).padStart(14, "0")}`;
}

export function installFakeRoutineApi() {
  const tokens = new Map<string, string>();
  const fires: Fire[] = [];
  const unexpected: string[] = [];
  const queue: FireOutcome[] = [];
  let sessions = 0;

  const reject = (reason: string): never => {
    unexpected.push(reason);
    throw new Error(`Unexpected request to the fake routine API: ${reason}`);
  };

  const fake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const routineId = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/([A-Za-z0-9_-]+)\/fire$/.exec(url)?.[1];
    if (!routineId) return reject(`unknown URL ${url}`);
    if (init?.method !== "POST") return reject(`method ${init?.method ?? "GET"}`);

    const headers = new Headers(init.headers);
    const names: string[] = [];
    headers.forEach((_value, key) => names.push(key));
    names.sort();
    if (names.join(",") !== EXPECTED_HEADERS.join(",")) return reject(`headers ${names.join(",")}`);
    if (headers.get("anthropic-beta") !== "experimental-cc-routine-2026-04-01") return reject("anthropic-beta header");
    if (headers.get("anthropic-version") !== "2023-06-01") return reject("anthropic-version header");
    if (headers.get("content-type") !== "application/json") return reject("content-type header");
    const token = /^Bearer (\S+)$/.exec(headers.get("authorization") ?? "")?.[1];
    if (!token) return reject("authorization header");

    let body: unknown;
    try {
      body = JSON.parse(String(init.body));
    } catch {
      return reject("body is not JSON");
    }
    const keys = typeof body === "object" && body !== null ? Object.keys(body) : [];
    const text = (body as { text?: unknown }).text;
    if (keys.join(",") !== "text" || typeof text !== "string") return reject(`body keys ${keys.join(",")}`);

    const outcome = queue.shift() ?? "ok";
    if (outcome === "network") throw new TypeError("fetch failed");
    if (outcome === 401 || tokens.get(routineId) !== token) {
      return Response.json(
        { type: "error", error: { type: "authentication_error", message: "invalid bearer token" } },
        { status: 401 },
      );
    }
    if (outcome === 429) {
      return Response.json({ type: "error", error: { type: "rate_limit_error", message: "rate limited" } }, { status: 429 });
    }
    if (outcome === 500) {
      return Response.json({ type: "error", error: { type: "api_error", message: "internal error" } }, { status: 500 });
    }
    fires.push({ routineId, token, text });
    sessions += 1;
    const id = sessionId(sessions);
    return Response.json({
      type: "routine_fire",
      claude_code_session_id: id,
      claude_code_session_url: `https://claude.ai/code/${id}`,
    });
  });

  vi.stubGlobal("fetch", fake);
  return {
    fires,
    unexpected,
    /** Registers the token the routine accepts. */
    allow(routineId: string, token: string) {
      tokens.set(routineId, token);
    },
    /** Makes the next fires fail in the given ways. */
    failNext(...outcomes: FireOutcome[]) {
      queue.push(...outcomes);
    },
  };
}

export type FakeRoutineApi = ReturnType<typeof installFakeRoutineApi>;

// The only module that talks to the routine trigger API. The API is a research
// preview, so every detail of it lives here.

const HOST = "api.anthropic.com";
const FIRE_PATH = /^\/v1\/claude_code\/routines\/([A-Za-z0-9_-]+)\/fire$/;

export const FIRE_URL_EXAMPLE = "https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEFGHJKLMNOPQRSTUVW/fire";

/** Returns the routine id of a valid fire URL, or an error message. */
export function parseFireUrl(raw: string): { ok: true; routineId: string } | { ok: false; message: string } {
  const invalid = { ok: false as const, message: `fireUrl must look like ${FIRE_URL_EXAMPLE}` };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return invalid;
  }
  if (url.protocol !== "https:" || url.hostname !== HOST || url.port !== "" || url.search || url.hash) return invalid;
  if (url.username || url.password) return invalid;
  const match = FIRE_PATH.exec(url.pathname);
  if (!match?.[1]) return invalid;
  return { ok: true, routineId: match[1] };
}

export const ROUTINE_BETA = "experimental-cc-routine-2026-04-01";
export const API_VERSION = "2023-06-01";

export type FireResult =
  | { ok: true; sessionId: string; sessionUrl: string }
  | { ok: false; reason: "unauthorized" | "rate_limited" | "http_error" | "network_error" | "bad_response"; status?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Starts one new session of the routine with `text` as its payload. The token
 * goes only into the Authorization header; no result or error carries it.
 */
export async function fireRoutine(fireUrl: string, token: string, text: string): Promise<FireResult> {
  let response: Response;
  try {
    response = await fetch(fireUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": ROUTINE_BETA,
        "anthropic-version": API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
  } catch {
    return { ok: false, reason: "network_error" };
  }
  if (response.status === 401) return { ok: false, reason: "unauthorized", status: 401 };
  if (response.status === 429) return { ok: false, reason: "rate_limited", status: 429 };
  if (!response.ok) return { ok: false, reason: "http_error", status: response.status };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "bad_response", status: response.status };
  }
  if (
    !isRecord(body) ||
    body.type !== "routine_fire" ||
    typeof body.claude_code_session_id !== "string" ||
    typeof body.claude_code_session_url !== "string" ||
    !body.claude_code_session_url.startsWith("https://")
  ) {
    return { ok: false, reason: "bad_response", status: response.status };
  }
  return { ok: true, sessionId: body.claude_code_session_id, sessionUrl: body.claude_code_session_url };
}

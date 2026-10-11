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

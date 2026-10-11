const MIN_SECRET_LENGTH = 16;

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

// Hashing first gives equal-length inputs, so the comparison time does not leak
// the secret's length or how many leading characters matched.
export async function secretsMatch(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/** Returns the secret segment of `/<prefix>/<secret>`, or null for any other shape. */
export function secretFromPath(pathname: string, prefix: string): string | null {
  const start = `/${prefix}/`;
  if (!pathname.startsWith(start)) return null;
  const rest = pathname.slice(start.length).replace(/\/$/, "");
  if (rest.length === 0 || rest.includes("/")) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    // A malformed escape such as "%zz" is a wrong secret, not a server error.
    return null;
  }
}

/** Returns the token of an `Authorization: Bearer <token>` header, or null. */
export function secretFromBearer(header: string | null): string | null {
  const match = /^\s*bearer\s+(.+?)\s*$/i.exec(header ?? "");
  return match?.[1] ?? null;
}

function configuredSecret(configured: string | undefined): string | null {
  return configured && configured.length >= MIN_SECRET_LENGTH ? configured : null;
}

/** True only when the configured secret is long enough and the path carries it. */
export async function isAuthorized(
  pathname: string,
  prefix: string,
  configured: string | undefined,
): Promise<boolean> {
  const expected = configuredSecret(configured);
  if (expected === null) return false;
  const given = secretFromPath(pathname, prefix);
  if (given === null) return false;
  return secretsMatch(given, expected);
}

export type AuthMethod = "bearer" | "path";

/**
 * Accepts the secret as a bearer header or as the path segment. A request that
 * carries both is authorized when either one is valid; bearer is checked first.
 */
export async function authMethod(
  pathname: string,
  prefix: string,
  authorization: string | null,
  configured: string | undefined,
): Promise<AuthMethod | null> {
  const expected = configuredSecret(configured);
  if (expected === null) return null;
  const bearer = secretFromBearer(authorization);
  if (bearer !== null && (await secretsMatch(bearer, expected))) return "bearer";
  if (await isAuthorized(pathname, prefix, configured)) return "path";
  return null;
}

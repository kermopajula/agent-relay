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
  return decodeURIComponent(rest);
}

/** True only when the configured secret is long enough and the path carries it. */
export async function isAuthorized(
  pathname: string,
  prefix: string,
  configured: string | undefined,
): Promise<boolean> {
  if (!configured || configured.length < MIN_SECRET_LENGTH) return false;
  const given = secretFromPath(pathname, prefix);
  if (given === null) return false;
  return secretsMatch(given, configured);
}

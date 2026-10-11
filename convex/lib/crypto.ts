const IV_BYTES = 12;
const KEY_BYTES = 32;
const FORMAT = "v1";

export const KEY_HELP =
  "TOKEN_ENCRYPTION_KEY must be 32 random bytes in base64. Generate one with `openssl rand -base64 32` " +
  "and set it with `npx convex env set TOKEN_ENCRYPTION_KEY <value> --prod`.";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A URL-safe random secret, 32 bytes unless told otherwise. */
export function randomSecret(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two strings in time that depends only on their length. */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export class KeyError extends Error {}

async function importKey(rawKey: string | undefined): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64((rawKey ?? "").trim());
  } catch {
    throw new KeyError(KEY_HELP);
  }
  if (bytes.length !== KEY_BYTES) throw new KeyError(KEY_HELP);
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-GCM with a random 96-bit IV. The result is `v1:<iv>:<ciphertext>` in base64. */
export async function encryptToken(token: string, rawKey: string | undefined): Promise<string> {
  const key = await importKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(token);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  return `${FORMAT}:${toBase64(iv)}:${toBase64(sealed)}`;
}

export async function decryptToken(stored: string, rawKey: string | undefined): Promise<string> {
  const key = await importKey(rawKey);
  const [format, iv, sealed] = stored.split(":");
  if (format !== FORMAT || !iv || !sealed) throw new KeyError("The stored token has an unknown format.");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, fromBase64(sealed));
    return new TextDecoder().decode(plain);
  } catch {
    throw new KeyError("The stored token could not be decrypted. Was TOKEN_ENCRYPTION_KEY changed?");
  }
}

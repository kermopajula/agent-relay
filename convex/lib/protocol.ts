export const MODERN_VERSIONS = ["2026-07-28"];
// Grok's client era is unknown, so the server also answers the `initialize`
// handshake of every earlier Streamable HTTP revision.
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const SUPPORTED_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
export const LATEST_LEGACY = "2025-11-25";

export const SERVER_INFO = { name: "agent-relay-spike", version: "0.1.0" };

export const ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  headerMismatch: -32020,
  unsupportedVersion: -32022,
} as const;

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
const META_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";

export type RpcId = string | number;
export type Params = Record<string, unknown>;
export type Era = "legacy" | "modern";

export type Incoming =
  | { kind: "request"; id: RpcId; method: string; params: Params }
  | { kind: "notification"; method: string; params: Params }
  | { kind: "response" }
  | { kind: "invalid"; id: RpcId | null; message: string };

export type ClientDetails = {
  protocolVersion?: string;
  clientName?: string;
  clientVersion?: string;
  capabilities?: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is RpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

export function classify(body: unknown): Incoming {
  if (Array.isArray(body)) {
    return { kind: "invalid", id: null, message: "Batch requests are not supported" };
  }
  if (!isRecord(body) || body.jsonrpc !== "2.0") {
    return { kind: "invalid", id: null, message: "Not a JSON-RPC 2.0 message" };
  }
  const id = isId(body.id) ? body.id : null;
  if (typeof body.method !== "string") {
    if ("result" in body || "error" in body) return { kind: "response" };
    return { kind: "invalid", id, message: "Missing method" };
  }
  if (body.params !== undefined && !isRecord(body.params)) {
    return { kind: "invalid", id, message: "params must be an object" };
  }
  const params = (body.params ?? {}) as Params;
  if (!("id" in body)) return { kind: "notification", method: body.method, params };
  if (id === null) return { kind: "invalid", id: null, message: "id must be a string or integer" };
  return { kind: "request", id, method: body.method, params };
}

function metaOf(params: Params): Record<string, unknown> {
  return isRecord(params._meta) ? params._meta : {};
}

/** The protocol version a modern request declares in `_meta`, if any. */
export function metaVersion(params: Params): string | undefined {
  const version = metaOf(params)[META_VERSION];
  return typeof version === "string" ? version : undefined;
}

export function eraOf(method: string, params: Params): Era {
  if (method === "initialize") return "legacy";
  const version = metaVersion(params);
  return version !== undefined && !LEGACY_VERSIONS.includes(version) ? "modern" : "legacy";
}

function implementation(value: unknown): { name?: string; version?: string } {
  if (!isRecord(value)) return {};
  return {
    name: typeof value.name === "string" ? value.name : undefined,
    version: typeof value.version === "string" ? value.version : undefined,
  };
}

export function clientDetails(method: string, params: Params, headerVersion: string | null): ClientDetails {
  if (method === "initialize") {
    const info = implementation(params.clientInfo);
    return {
      protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : undefined,
      clientName: info.name,
      clientVersion: info.version,
      capabilities: params.capabilities === undefined ? undefined : JSON.stringify(params.capabilities),
    };
  }
  const meta = metaOf(params);
  const info = implementation(meta[META_CLIENT_INFO]);
  const caps = meta[META_CAPABILITIES];
  return {
    protocolVersion: metaVersion(params) ?? headerVersion ?? undefined,
    clientName: info.name,
    clientVersion: info.version,
    capabilities: caps === undefined ? undefined : JSON.stringify(caps),
  };
}

export function negotiateLegacyVersion(requested: unknown): string {
  return typeof requested === "string" && LEGACY_VERSIONS.includes(requested) ? requested : LATEST_LEGACY;
}

function decodeHeaderValue(value: string): string {
  const encoded = /^=\?base64\?(.*)\?=$/.exec(value);
  if (!encoded?.[1]) return value;
  try {
    const bytes = Uint8Array.from(atob(encoded[1]), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return value;
  }
}

const NAMED_METHODS: Record<string, "name" | "uri"> = {
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
};

/** Modern requests mirror body fields into headers; returns a mismatch message or null. */
export function headerMismatch(headers: Headers, method: string, params: Params): string | null {
  const bodyVersion = metaVersion(params);
  const headerVersion = headers.get("mcp-protocol-version");
  if (headerVersion !== bodyVersion) {
    return `MCP-Protocol-Version header '${headerVersion ?? "missing"}' does not match body '${bodyVersion}'`;
  }
  const headerMethod = headers.get("mcp-method");
  if (headerMethod !== method) {
    return `Mcp-Method header '${headerMethod ?? "missing"}' does not match body '${method}'`;
  }
  const nameField = NAMED_METHODS[method];
  if (nameField) {
    const bodyName = params[nameField];
    const rawHeader = headers.get("mcp-name");
    const headerName = rawHeader === null ? null : decodeHeaderValue(rawHeader);
    if (headerName !== bodyName) {
      return `Mcp-Name header '${headerName ?? "missing"}' does not match body '${String(bodyName)}'`;
    }
  }
  return null;
}

export function hasClientCapabilities(params: Params): boolean {
  return isRecord(metaOf(params)[META_CAPABILITIES]);
}

export function result(id: RpcId, era: Era, payload: Record<string, unknown>) {
  const body =
    era === "modern"
      ? { resultType: "complete", ...payload, _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO } }
      : payload;
  return { jsonrpc: "2.0" as const, id, result: body };
}

export function rpcError(id: RpcId | null, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { handleLog } from "./logEndpoint";
import { handleNotAllowed, handleOptions, handlePost } from "./mcp";

const http = httpRouter();

// Bare `/mcp` takes the secret as a bearer header. `/mcp/` (trailing slash) and
// `/mcp/<SECRET>` reach the prefix routes; the gate accepts either credential.
const options = httpAction((_ctx, req) => handleOptions(req));
http.route({ path: "/mcp", method: "POST", handler: httpAction(handlePost) });
http.route({ path: "/mcp", method: "GET", handler: httpAction(handleNotAllowed) });
http.route({ path: "/mcp", method: "DELETE", handler: httpAction(handleNotAllowed) });
http.route({ path: "/mcp", method: "OPTIONS", handler: options });

http.route({ pathPrefix: "/mcp/", method: "POST", handler: httpAction(handlePost) });
http.route({ pathPrefix: "/mcp/", method: "GET", handler: httpAction(handleNotAllowed) });
http.route({ pathPrefix: "/mcp/", method: "DELETE", handler: httpAction(handleNotAllowed) });
http.route({ pathPrefix: "/mcp/", method: "OPTIONS", handler: options });
http.route({ pathPrefix: "/log/", method: "GET", handler: httpAction(handleLog) });

export default http;

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { handleLog } from "./logEndpoint";
import { handleNotAllowed, handleOptions, handlePost } from "./mcp";

const http = httpRouter();

http.route({ pathPrefix: "/mcp/", method: "POST", handler: httpAction(handlePost) });
http.route({ pathPrefix: "/mcp/", method: "GET", handler: httpAction(handleNotAllowed) });
http.route({ pathPrefix: "/mcp/", method: "DELETE", handler: httpAction(handleNotAllowed) });
http.route({ pathPrefix: "/mcp/", method: "OPTIONS", handler: httpAction((_ctx, req) => handleOptions(req)) });
http.route({ pathPrefix: "/log/", method: "GET", handler: httpAction(handleLog) });

export default http;

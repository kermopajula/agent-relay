/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as calls from "../calls.js";
import type * as http from "../http.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_http from "../lib/http.js";
import type * as lib_match from "../lib/match.js";
import type * as lib_names from "../lib/names.js";
import type * as lib_payload from "../lib/payload.js";
import type * as lib_protocol from "../lib/protocol.js";
import type * as lib_report from "../lib/report.js";
import type * as lib_routineApi from "../lib/routineApi.js";
import type * as lib_secret from "../lib/secret.js";
import type * as lib_speech from "../lib/speech.js";
import type * as lib_status from "../lib/status.js";
import type * as lib_summary from "../lib/summary.js";
import type * as lib_toolDefinitions from "../lib/toolDefinitions.js";
import type * as logEndpoint from "../logEndpoint.js";
import type * as mcp from "../mcp.js";
import type * as projects from "../projects.js";
import type * as sendTask from "../sendTask.js";
import type * as tasks from "../tasks.js";
import type * as toolRunner from "../toolRunner.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  calls: typeof calls;
  http: typeof http;
  "lib/config": typeof lib_config;
  "lib/crypto": typeof lib_crypto;
  "lib/http": typeof lib_http;
  "lib/match": typeof lib_match;
  "lib/names": typeof lib_names;
  "lib/payload": typeof lib_payload;
  "lib/protocol": typeof lib_protocol;
  "lib/report": typeof lib_report;
  "lib/routineApi": typeof lib_routineApi;
  "lib/secret": typeof lib_secret;
  "lib/speech": typeof lib_speech;
  "lib/status": typeof lib_status;
  "lib/summary": typeof lib_summary;
  "lib/toolDefinitions": typeof lib_toolDefinitions;
  logEndpoint: typeof logEndpoint;
  mcp: typeof mcp;
  projects: typeof projects;
  sendTask: typeof sendTask;
  tasks: typeof tasks;
  toolRunner: typeof toolRunner;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

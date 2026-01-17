/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiUsage from "../aiUsage.js";
import type * as billing from "../billing.js";
import type * as crons from "../crons.js";
import type * as invitations from "../invitations.js";
import type * as lib_encryption from "../lib/encryption.js";
import type * as lib_modelTiers from "../lib/modelTiers.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as organizations from "../organizations.js";
import type * as toolApprovals from "../toolApprovals.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiUsage: typeof aiUsage;
  billing: typeof billing;
  crons: typeof crons;
  invitations: typeof invitations;
  "lib/encryption": typeof lib_encryption;
  "lib/modelTiers": typeof lib_modelTiers;
  "lib/permissions": typeof lib_permissions;
  organizations: typeof organizations;
  toolApprovals: typeof toolApprovals;
  tools: typeof tools;
  users: typeof users;
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

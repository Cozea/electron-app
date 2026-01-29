/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as aiUsage from "../aiUsage.js";
import type * as billing from "../billing.js";
import type * as builderRuns from "../builderRuns.js";
import type * as crons from "../crons.js";
import type * as integrations from "../integrations.js";
import type * as invitations from "../invitations.js";
import type * as lib_encryption from "../lib/encryption.js";
import type * as lib_modelTiers from "../lib/modelTiers.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_seatLimits from "../lib/seatLimits.js";
import type * as organizations from "../organizations.js";
import type * as projectFileLocks from "../projectFileLocks.js";
import type * as projectFiles from "../projectFiles.js";
import type * as projectInvites from "../projectInvites.js";
import type * as projectMembers from "../projectMembers.js";
import type * as projectMessages from "../projectMessages.js";
import type * as projectPresence from "../projectPresence.js";
import type * as projectTemplates from "../projectTemplates.js";
import type * as projects from "../projects.js";
import type * as toolApprovals from "../toolApprovals.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";
import type * as yjs from "../yjs.js";
import type * as yjsAwareness from "../yjsAwareness.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  aiUsage: typeof aiUsage;
  billing: typeof billing;
  builderRuns: typeof builderRuns;
  crons: typeof crons;
  integrations: typeof integrations;
  invitations: typeof invitations;
  "lib/encryption": typeof lib_encryption;
  "lib/modelTiers": typeof lib_modelTiers;
  "lib/permissions": typeof lib_permissions;
  "lib/seatLimits": typeof lib_seatLimits;
  organizations: typeof organizations;
  projectFileLocks: typeof projectFileLocks;
  projectFiles: typeof projectFiles;
  projectInvites: typeof projectInvites;
  projectMembers: typeof projectMembers;
  projectMessages: typeof projectMessages;
  projectPresence: typeof projectPresence;
  projectTemplates: typeof projectTemplates;
  projects: typeof projects;
  toolApprovals: typeof toolApprovals;
  tools: typeof tools;
  users: typeof users;
  yjs: typeof yjs;
  yjsAwareness: typeof yjsAwareness;
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

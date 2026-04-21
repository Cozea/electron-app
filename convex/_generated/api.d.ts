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
import type * as clean from "../clean.js";
import type * as crons from "../crons.js";
import type * as deployments from "../deployments.js";
import type * as fileTombstones from "../fileTombstones.js";
import type * as lib_encryption from "../lib/encryption.js";
import type * as lib_modelTiers from "../lib/modelTiers.js";
import type * as lib_planNames from "../lib/planNames.js";
import type * as lib_projectAccess from "../lib/projectAccess.js";
import type * as lib_projectGitMetadata from "../lib/projectGitMetadata.js";
import type * as lib_projectPagination from "../lib/projectPagination.js";
import type * as lib_projectSharing from "../lib/projectSharing.js";
import type * as lib_usagePeriods from "../lib/usagePeriods.js";
import type * as lib_workspaceLimits from "../lib/workspaceLimits.js";
import type * as lib_workspaceProjectAccess from "../lib/workspaceProjectAccess.js";
import type * as projectAssets from "../projectAssets.js";
import type * as projectFileLocks from "../projectFileLocks.js";
import type * as projectFiles from "../projectFiles.js";
import type * as projectInvites from "../projectInvites.js";
import type * as projectJoinLinks from "../projectJoinLinks.js";
import type * as projectMembers from "../projectMembers.js";
import type * as projectPresence from "../projectPresence.js";
import type * as projectTasks from "../projectTasks.js";
import type * as projects from "../projects.js";
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
  clean: typeof clean;
  crons: typeof crons;
  deployments: typeof deployments;
  fileTombstones: typeof fileTombstones;
  "lib/encryption": typeof lib_encryption;
  "lib/modelTiers": typeof lib_modelTiers;
  "lib/planNames": typeof lib_planNames;
  "lib/projectAccess": typeof lib_projectAccess;
  "lib/projectGitMetadata": typeof lib_projectGitMetadata;
  "lib/projectPagination": typeof lib_projectPagination;
  "lib/projectSharing": typeof lib_projectSharing;
  "lib/usagePeriods": typeof lib_usagePeriods;
  "lib/workspaceLimits": typeof lib_workspaceLimits;
  "lib/workspaceProjectAccess": typeof lib_workspaceProjectAccess;
  projectAssets: typeof projectAssets;
  projectFileLocks: typeof projectFileLocks;
  projectFiles: typeof projectFiles;
  projectInvites: typeof projectInvites;
  projectJoinLinks: typeof projectJoinLinks;
  projectMembers: typeof projectMembers;
  projectPresence: typeof projectPresence;
  projectTasks: typeof projectTasks;
  projects: typeof projects;
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

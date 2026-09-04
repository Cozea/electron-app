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
import type * as collaborationRepositories from "../collaborationRepositories.js";
import type * as collaborationRoomAuthorization from "../collaborationRoomAuthorization.js";
import type * as collaborationSessions from "../collaborationSessions.js";
import type * as crons from "../crons.js";
import type * as deployments from "../deployments.js";
import type * as devApps from "../devApps.js";
import type * as fileTombstones from "../fileTombstones.js";
import type * as lib_authenticatedFunctions from "../lib/authenticatedFunctions.js";
import type * as lib_devAppReferenceResolution from "../lib/devAppReferenceResolution.js";
import type * as lib_deviceAuth from "../lib/deviceAuth.js";
import type * as lib_encryption from "../lib/encryption.js";
import type * as lib_modelTiers from "../lib/modelTiers.js";
import type * as lib_orgAccess from "../lib/orgAccess.js";
import type * as lib_planNames from "../lib/planNames.js";
import type * as lib_projectAccess from "../lib/projectAccess.js";
import type * as lib_projectGitMetadata from "../lib/projectGitMetadata.js";
import type * as lib_projectPagination from "../lib/projectPagination.js";
import type * as lib_projectSharing from "../lib/projectSharing.js";
import type * as lib_storageHash from "../lib/storageHash.js";
import type * as lib_usagePeriods from "../lib/usagePeriods.js";
import type * as lib_workspaceLimits from "../lib/workspaceLimits.js";
import type * as lib_workspaceProjectAccess from "../lib/workspaceProjectAccess.js";
import type * as organizationInvites from "../organizationInvites.js";
import type * as organizations from "../organizations.js";
import type * as projectAssets from "../projectAssets.js";
import type * as projectFileLocks from "../projectFileLocks.js";
import type * as projectFiles from "../projectFiles.js";
import type * as projectInvites from "../projectInvites.js";
import type * as projectJoinLinks from "../projectJoinLinks.js";
import type * as projectMembers from "../projectMembers.js";
import type * as projectPresence from "../projectPresence.js";
import type * as projectTasks from "../projectTasks.js";
import type * as projects from "../projects.js";
import type * as schema_base from "../schema/base.js";
import type * as schema_collaboration from "../schema/collaboration.js";
import type * as schema_collaborationRepositories from "../schema/collaborationRepositories.js";
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
  collaborationRepositories: typeof collaborationRepositories;
  collaborationRoomAuthorization: typeof collaborationRoomAuthorization;
  collaborationSessions: typeof collaborationSessions;
  crons: typeof crons;
  deployments: typeof deployments;
  devApps: typeof devApps;
  fileTombstones: typeof fileTombstones;
  "lib/authenticatedFunctions": typeof lib_authenticatedFunctions;
  "lib/devAppReferenceResolution": typeof lib_devAppReferenceResolution;
  "lib/deviceAuth": typeof lib_deviceAuth;
  "lib/encryption": typeof lib_encryption;
  "lib/modelTiers": typeof lib_modelTiers;
  "lib/orgAccess": typeof lib_orgAccess;
  "lib/planNames": typeof lib_planNames;
  "lib/projectAccess": typeof lib_projectAccess;
  "lib/projectGitMetadata": typeof lib_projectGitMetadata;
  "lib/projectPagination": typeof lib_projectPagination;
  "lib/projectSharing": typeof lib_projectSharing;
  "lib/storageHash": typeof lib_storageHash;
  "lib/usagePeriods": typeof lib_usagePeriods;
  "lib/workspaceLimits": typeof lib_workspaceLimits;
  "lib/workspaceProjectAccess": typeof lib_workspaceProjectAccess;
  organizationInvites: typeof organizationInvites;
  organizations: typeof organizations;
  projectAssets: typeof projectAssets;
  projectFileLocks: typeof projectFileLocks;
  projectFiles: typeof projectFiles;
  projectInvites: typeof projectInvites;
  projectJoinLinks: typeof projectJoinLinks;
  projectMembers: typeof projectMembers;
  projectPresence: typeof projectPresence;
  projectTasks: typeof projectTasks;
  projects: typeof projects;
  "schema/base": typeof schema_base;
  "schema/collaboration": typeof schema_collaboration;
  "schema/collaborationRepositories": typeof schema_collaborationRepositories;
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

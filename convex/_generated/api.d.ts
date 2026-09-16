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
import type * as collaborationSessionMedia from "../collaborationSessionMedia.js";
import type * as collaborationSessionMetrics from "../collaborationSessionMetrics.js";
import type * as collaborationSessions from "../collaborationSessions.js";
import type * as crons from "../crons.js";
import type * as devApps from "../devApps.js";
import type * as devicePrincipals from "../devicePrincipals.js";
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
import type * as lib_projectSharing from "../lib/projectSharing.js";
import type * as lib_sessionLifecycle from "../lib/sessionLifecycle.js";
import type * as lib_storageHash from "../lib/storageHash.js";
import type * as lib_usagePeriods from "../lib/usagePeriods.js";
import type * as lib_workspaceLimits from "../lib/workspaceLimits.js";
import type * as lib_workspaceProjectAccess from "../lib/workspaceProjectAccess.js";
import type * as organizations from "../organizations.js";
import type * as projectDeviceEnrollments from "../projectDeviceEnrollments.js";
import type * as projectJoinLinks from "../projectJoinLinks.js";
import type * as projectMembers from "../projectMembers.js";
import type * as projectPresence from "../projectPresence.js";
import type * as projectTasks from "../projectTasks.js";
import type * as projects from "../projects.js";
import type * as sessionRepositoryCredentials from "../sessionRepositoryCredentials.js";
import type * as yjs from "../yjs.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  collaborationSessionMedia: typeof collaborationSessionMedia;
  collaborationSessionMetrics: typeof collaborationSessionMetrics;
  collaborationSessions: typeof collaborationSessions;
  crons: typeof crons;
  devApps: typeof devApps;
  devicePrincipals: typeof devicePrincipals;
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
  "lib/projectSharing": typeof lib_projectSharing;
  "lib/sessionLifecycle": typeof lib_sessionLifecycle;
  "lib/storageHash": typeof lib_storageHash;
  "lib/usagePeriods": typeof lib_usagePeriods;
  "lib/workspaceLimits": typeof lib_workspaceLimits;
  "lib/workspaceProjectAccess": typeof lib_workspaceProjectAccess;
  organizations: typeof organizations;
  projectDeviceEnrollments: typeof projectDeviceEnrollments;
  projectJoinLinks: typeof projectJoinLinks;
  projectMembers: typeof projectMembers;
  projectPresence: typeof projectPresence;
  projectTasks: typeof projectTasks;
  projects: typeof projects;
  sessionRepositoryCredentials: typeof sessionRepositoryCredentials;
  yjs: typeof yjs;
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

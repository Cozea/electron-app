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
import type * as aiConversations from "../aiConversations.js";
import type * as aiRuntime from "../aiRuntime.js";
import type * as aiUsage from "../aiUsage.js";
import type * as aiWallets from "../aiWallets.js";
import type * as billing from "../billing.js";
import type * as builderRuns from "../builderRuns.js";
import type * as crons from "../crons.js";
import type * as deployments from "../deployments.js";
import type * as fileTombstones from "../fileTombstones.js";
import type * as identityRepair from "../identityRepair.js";
import type * as integrations from "../integrations.js";
import type * as invitations from "../invitations.js";
import type * as lib_accountEntitlements from "../lib/accountEntitlements.js";
import type * as lib_encryption from "../lib/encryption.js";
import type * as lib_modelTiers from "../lib/modelTiers.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_planNames from "../lib/planNames.js";
import type * as lib_seatLimits from "../lib/seatLimits.js";
import type * as lib_usagePeriods from "../lib/usagePeriods.js";
import type * as lib_walletPolicy from "../lib/walletPolicy.js";
import type * as lib_workspaceLimits from "../lib/workspaceLimits.js";
import type * as organizations from "../organizations.js";
import type * as projectAssets from "../projectAssets.js";
import type * as projectFileLocks from "../projectFileLocks.js";
import type * as projectFiles from "../projectFiles.js";
import type * as projectInvites from "../projectInvites.js";
import type * as projectJoinLinks from "../projectJoinLinks.js";
import type * as projectMembers from "../projectMembers.js";
import type * as projectMessages from "../projectMessages.js";
import type * as projectPresence from "../projectPresence.js";
import type * as projectReplicaGit from "../projectReplicaGit.js";
import type * as projectReplicaLfs from "../projectReplicaLfs.js";
import type * as projectTemplates from "../projectTemplates.js";
import type * as projects from "../projects.js";
import type * as toolApprovals from "../toolApprovals.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";
import type * as waitlist from "../waitlist.js";
import type * as yjs from "../yjs.js";
import type * as yjsAwareness from "../yjsAwareness.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  aiConversations: typeof aiConversations;
  aiRuntime: typeof aiRuntime;
  aiUsage: typeof aiUsage;
  aiWallets: typeof aiWallets;
  billing: typeof billing;
  builderRuns: typeof builderRuns;
  crons: typeof crons;
  deployments: typeof deployments;
  fileTombstones: typeof fileTombstones;
  identityRepair: typeof identityRepair;
  integrations: typeof integrations;
  invitations: typeof invitations;
  "lib/accountEntitlements": typeof lib_accountEntitlements;
  "lib/encryption": typeof lib_encryption;
  "lib/modelTiers": typeof lib_modelTiers;
  "lib/permissions": typeof lib_permissions;
  "lib/planNames": typeof lib_planNames;
  "lib/seatLimits": typeof lib_seatLimits;
  "lib/usagePeriods": typeof lib_usagePeriods;
  "lib/walletPolicy": typeof lib_walletPolicy;
  "lib/workspaceLimits": typeof lib_workspaceLimits;
  organizations: typeof organizations;
  projectAssets: typeof projectAssets;
  projectFileLocks: typeof projectFileLocks;
  projectFiles: typeof projectFiles;
  projectInvites: typeof projectInvites;
  projectJoinLinks: typeof projectJoinLinks;
  projectMembers: typeof projectMembers;
  projectMessages: typeof projectMessages;
  projectPresence: typeof projectPresence;
  projectReplicaGit: typeof projectReplicaGit;
  projectReplicaLfs: typeof projectReplicaLfs;
  projectTemplates: typeof projectTemplates;
  projects: typeof projects;
  toolApprovals: typeof toolApprovals;
  tools: typeof tools;
  users: typeof users;
  waitlist: typeof waitlist;
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

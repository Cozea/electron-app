import type { ConvexReactClient } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { syncProjectRepositoryAccess } from "@/lib/git/projectRepoAutomation";
import {
  resolveProjectIntegrationProvider,
  resolveProjectRepoAccessStatus,
} from "@/lib/git/projectRepoAccess";
import { resolveProjectWorkingCopyMode } from "@/lib/git/projectGitRuntime";
import { projectOpenDesktopClient } from "./projectOpenDesktopClient";
import type { ProjectOpenGitProjectLike } from "./projectOpenTypes";

async function promptForMissingProjectSourceControl(args: {
  provider: "github" | "gitlab";
  projectName: string;
  settingsScope: "user" | "workspace";
  detail: string;
}): Promise<"later" | "open-settings"> {
  const providerLabel = args.provider === "github" ? "GitHub" : "GitLab";
  const result = await projectOpenDesktopClient.showMessageBox({
    type: "warning",
    buttons: ["Later", "Open Source Control"],
    defaultId: 1,
    cancelId: 0,
    title: `${providerLabel} setup needed`,
    message: `Set up ${providerLabel} before opening ${args.projectName}.`,
    detail: args.detail,
    noLink: true,
  });

  if (result.response !== 1) {
    return "later";
  }

  const settingsRoute = "/settings/source-control";
  const openResult = await projectOpenDesktopClient.openSettings(settingsRoute);
  if (!openResult?.success) {
    throw new Error(openResult?.error || "Failed to open Source Control settings");
  }

  return "open-settings";
}

export async function ensureProjectSourceControlReadyForOpen(args: {
  convex: ConvexReactClient;
  project: ProjectOpenGitProjectLike;
  userId: Id<"users">;
}): Promise<boolean> {
  const provider = resolveProjectIntegrationProvider(args.project);
  const workingCopyMode = resolveProjectWorkingCopyMode(args.project.sourceControl);
  const repoUrl =
    args.project.gitRepository?.url?.trim() ||
    args.project.sourceControl?.repoUrl?.trim() ||
    "";

  if (!provider || workingCopyMode === "attached" || !repoUrl) {
    return true;
  }

  const providerContext = await args.convex.query(api.sourceControl.getProjectProviderContext, {
    projectId: args.project._id,
    userId: args.userId,
  });

  const repoAccessStatus = resolveProjectRepoAccessStatus({
    project: args.project,
    sourceControlConnection: providerContext?.connection ?? null,
    isPersonalWorkspace: providerContext?.isPersonalWorkspace,
  });

  if (
    repoAccessStatus.state !== "integration_missing" &&
    repoAccessStatus.state !== "integration_mismatch"
  ) {
    return true;
  }

  const projectName = args.project.name?.trim() || args.project.slug;
  await promptForMissingProjectSourceControl({
    provider,
    projectName,
    settingsScope: providerContext?.settingsScope === "workspace" ? "workspace" : "user",
    detail: repoAccessStatus.description,
  });

  return false;
}

export async function ensureProjectRepositoryAccessForOpen(args: {
  convex: ConvexReactClient;
  project: ProjectOpenGitProjectLike;
  userId: Id<"users">;
}): Promise<boolean> {
  const provider =
    args.project.gitRepository?.provider?.trim().toLowerCase() ??
    args.project.sourceControl?.provider?.trim().toLowerCase();
  const workingCopyMode = resolveProjectWorkingCopyMode(args.project.sourceControl);
  const repoUrl =
    args.project.gitRepository?.url?.trim() ||
    args.project.sourceControl?.repoUrl?.trim() ||
    "";

  if (
    workingCopyMode === "attached" ||
    !repoUrl ||
    (provider !== "github" && provider !== "gitlab")
  ) {
    return true;
  }

  if (args.project.createdBy === args.userId) {
    return true;
  }

  const [user, memberRole, repoAccessRows] = await Promise.all([
    args.convex.query(api.users.getById, {
      userId: args.userId,
    }),
    args.convex.query(api.projectMembers.getMemberRole, {
      projectId: args.project._id,
      userId: args.userId,
    }),
    args.convex.query(api.projectRepoAccess.listForProject, {
      projectId: args.project._id,
      viewerUserId: args.userId,
    }),
  ]);

  const normalizedEmail = user?.email?.trim().toLowerCase() || undefined;
  const currentRole =
    memberRole === "project_manager" ||
    memberRole === "developer" ||
    memberRole === "designer" ||
    memberRole === "viewer"
      ? memberRole
      : "viewer";
  const existingRepoAccess =
    repoAccessRows.find((entry) => entry.memberUserId === args.userId) ??
    (normalizedEmail
      ? repoAccessRows.find((entry) => entry.inviteEmail === normalizedEmail)
      : undefined);

  if (
    existingRepoAccess?.accessState === "granted" &&
    existingRepoAccess.role === currentRole
  ) {
    return true;
  }

  let providerAccountHandle = existingRepoAccess?.providerAccountHandle;

  if (provider === "github" && !providerAccountHandle) {
    const providedHandle = window.prompt(
      "Enter your GitHub username to grant repository access for this project.",
    );
    if (!providedHandle?.trim()) {
      return false;
    }
    providerAccountHandle = providedHandle.trim();
  }

  if (provider === "gitlab" && !normalizedEmail) {
    throw new Error(
      "Repository access requires an email address on your account before this project can open.",
    );
  }

  const outcome = await syncProjectRepositoryAccess({
    convex: args.convex,
    project: args.project,
    actorUserId: args.userId,
    subjectType: "member",
    memberUserId: args.userId,
    inviteEmail: normalizedEmail,
    providerAccountHandle,
    role: currentRole,
    action: "grant",
    isPersonalWorkspace: args.project.sourceControl?.setupMode !== "organization",
  });

  if (outcome.accessState === "granted") {
    return true;
  }

  if (outcome.accessState === "pending") {
    throw new Error(
      outcome.error ||
        "Repository access is pending. Accept the provider invitation, then reopen this project.",
    );
  }

  if (outcome.accessState === "needs_identity") {
    throw new Error(
      outcome.error ||
        "Repository access requires your provider identity before this project can open.",
    );
  }

  throw new Error(
    outcome.error || "Repository access must be resolved before this project can open.",
  );
}

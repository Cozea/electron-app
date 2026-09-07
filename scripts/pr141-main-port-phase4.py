#!/usr/bin/env python3
from pathlib import Path


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)

repo_types = Path("shared/collaborationRepository.ts")
text = repo_types.read_text()
if "export function createGitHubExtraHeader" not in text:
    text += r'''

export function createGitHubExtraHeader(token: string): string {
  const normalized = token.trim()
  if (!normalized) throw new Error("GitHub access token is required")
  return `AUTHORIZATION: basic ${btoa(`x-access-token:${normalized}`)}`
}
'''
repo_types.write_text(text)

write("apps/desktop/src/features/collaboration/api/collaborationGatewayClient.ts", r'''import { getDeviceGatewayBaseUrl, getDeviceSession } from "@/lib/deviceSession"
import {
  createGitHubExtraHeader,
  type CollaborationPushVerificationResponse,
  type CollaborationRepositoryCredentialOperation,
  type CollaborationRepositoryCredentialResponse,
} from "@shared/collaborationRepository"

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as
    | T
    | { payload?: { message?: string }; message?: string; error?: string }
    | null
  if (!response.ok) {
    const candidate = payload && typeof payload === "object"
      ? payload as { payload?: { message?: string }; message?: string; error?: string }
      : null
    throw new Error(
      candidate?.payload?.message || candidate?.message || candidate?.error || `Request failed (${response.status})`,
    )
  }
  return payload as T
}

async function authenticatedPost<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = getDeviceGatewayBaseUrl()
  const session = await getDeviceSession()
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "error",
    cache: "no-store",
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(body),
  })
  return await parseResponse<T>(response)
}

export async function requestCollaborationRepositoryCredential(args: {
  projectId: string
  operation: CollaborationRepositoryCredentialOperation
  sessionId?: string
}): Promise<CollaborationRepositoryCredentialResponse> {
  const credential = await authenticatedPost<CollaborationRepositoryCredentialResponse>(
    "/collab/repository/credential",
    args,
  )
  if (
    credential.operation !== args.operation ||
    credential.repository?.provider !== "github" ||
    !credential.repository.repositoryId ||
    !credential.repository.cloneUrl ||
    !credential.repository.defaultBranch ||
    !credential.token ||
    !Number.isFinite(credential.expiresAt) ||
    credential.expiresAt <= Date.now()
  ) {
    throw new Error("Repository credential response is invalid")
  }
  return credential
}

export async function resolveGitHubBranchHead(
  credential: CollaborationRepositoryCredentialResponse,
  branch: string,
): Promise<string> {
  const normalizedBranch = branch.trim()
  if (!normalizedBranch) throw new Error("Git branch is required")
  const encodedBranch = normalizedBranch.split("/").map(encodeURIComponent).join("/")
  const { owner, name } = credential.repository
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/ref/heads/${encodedBranch}`,
    {
      redirect: "error",
      cache: "no-store",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${credential.token}`,
        "x-github-api-version": "2022-11-28",
      },
    },
  )
  const result = await parseResponse<{ object?: { sha?: string } }>(response)
  const commitSha = result.object?.sha?.trim().toLowerCase() ?? ""
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error("GitHub did not return an exact branch commit")
  return commitSha
}

export async function verifyCollaborationPush(args: {
  sessionId: string
  commitSha: string
}): Promise<CollaborationPushVerificationResponse> {
  return await authenticatedPost<CollaborationPushVerificationResponse>(
    "/collab/repository/verify-push",
    args,
  )
}

export function repositoryGitAuthOptions(credential: CollaborationRepositoryCredentialResponse): {
  provider: "github"
  extraHeader: string
} {
  return { provider: "github", extraHeader: createGitHubExtraHeader(credential.token) }
}
''')

write("apps/desktop/src/features/collaboration/api/downloadAuthorizedProjectRepository.ts", r'''import {
  repositoryGitAuthOptions,
  requestCollaborationRepositoryCredential,
} from "@/features/collaboration/api/collaborationGatewayClient"
import type { CollaborationRepositoryDescriptor } from "@shared/collaborationRepository"
import type { LocalWorkspaceDTO } from "@shared/workspaceTypes"

export interface DownloadAuthorizedProjectRepositoryResult {
  workspace: LocalWorkspaceDTO
  repository: CollaborationRepositoryDescriptor
}

/**
 * Materialize an authorized shared project directly from GitHub into a Cozea-managed
 * workspace. The gateway returns repository identity and the short-lived credential
 * atomically, eliminating the stale-binding window that existed in PR141.
 */
export async function downloadAuthorizedProjectRepository(args: {
  projectId: string
  slug: string
}): Promise<DownloadAuthorizedProjectRepositoryResult> {
  const workspace = window.electronAPI.workspace
  if (!workspace) throw new Error("Local workspace management is unavailable")

  const credential = await requestCollaborationRepositoryCredential({
    projectId: args.projectId,
    operation: "read",
  })
  const repository = credential.repository
  const auth = repositoryGitAuthOptions(credential)

  const created = await workspace.createForProject({
    projectId: args.projectId,
    slug: args.slug,
    initGit: true,
    setActive: true,
  })
  if (!created.success || !created.workspace) {
    throw new Error(created.error || "Could not create the local project workspace")
  }

  const workspaceId = created.workspace.workspaceId
  try {
    const ensured = await window.electronAPI.workspaceSync.gitEnsureRepo({
      workspaceId,
      branch: repository.defaultBranch,
      repoUrl: repository.cloneUrl,
    })
    if (!ensured.success) throw new Error(ensured.error || "Could not initialize the local Git repository")

    const fetched = await window.electronAPI.workspaceSync.gitFetchMain({
      workspaceId,
      remote: "origin",
      branch: repository.defaultBranch,
      provider: auth.provider,
      extraHeader: auth.extraHeader,
    })
    if (!fetched.success) throw new Error(fetched.error || "Could not download the project from GitHub")

    const restored = await window.electronAPI.workspaceSync.gitRestoreMain({
      workspaceId,
      remote: "origin",
      branch: repository.defaultBranch,
      repoUrl: repository.cloneUrl,
      provider: auth.provider,
      extraHeader: auth.extraHeader,
    })
    if (!restored.success) throw new Error(restored.error || "Could not materialize the downloaded project")

    const verified = await workspace.verify(workspaceId)
    if (!verified.workspace) throw new Error("The downloaded project workspace could not be verified")
    return { workspace: verified.workspace, repository }
  } catch (error) {
    await workspace.trashManagedWorkspace(workspaceId).catch(() => undefined)
    throw error
  }
}
''')

# Validate the actual renderer-configured gateway before any bearer credential is sent.
device_path = Path("apps/desktop/src/lib/deviceSession.ts")
device = device_path.read_text()
imp = 'import { validateDeviceGatewayUrl } from "@shared/gatewayUrl"\n'
if imp not in device:
    anchor = 'import type { PersonalWorkspaceMembership, User } from "@shared/types"\n'
    if anchor not in device: raise SystemExit("deviceSession import anchor missing")
    device = device.replace(anchor, anchor + imp, 1)
old = '''function getAuthBaseUrl(): string {
  const configured = import.meta.env.VITE_AUTH_SERVER_URL || import.meta.env.VITE_COLLAB_BASE_URL
  if (!configured) {
    throw new Error("Device authentication server is not configured.")
  }
  return configured.replace(/\\/+$/, "")
}
'''
new = '''function getAuthBaseUrl(): string {
  const configured = import.meta.env.VITE_AUTH_SERVER_URL || import.meta.env.VITE_COLLAB_BASE_URL
  if (!configured) throw new Error("Device authentication server is not configured.")
  return validateDeviceGatewayUrl(configured)
}
'''
if old not in device: raise SystemExit("deviceSession gateway function anchor missing")
device = device.replace(old, new, 1)
device_path.write_text(device)

# Project repair/first-open clone uses authenticated GitHub materialization when the
# canonical project.repo says this is a GitHub project. Local/other providers keep
# the existing clone fallback.
layout_path = Path("apps/desktop/src/features/projects/layouts/ProjectLayout.tsx")
layout = layout_path.read_text()
imp = 'import { downloadAuthorizedProjectRepository } from "@/features/collaboration/api/downloadAuthorizedProjectRepository";\n'
if imp not in layout:
    anchor = 'import { resolveProjectSharedBranch } from "@/lib/git/projectRepositoryIntegration";\n'
    if anchor not in layout: raise SystemExit("ProjectLayout import anchor missing")
    layout = layout.replace(anchor, anchor + imp, 1)
old_repo = '''      const repoUrl =
        (project as { repoSource?: { repoUrl?: string | null } | null } | null | undefined)?.repoSource?.repoUrl ??
        (project as { sourceControl?: { repoUrl?: string | null } | null } | null | undefined)?.sourceControl?.repoUrl ??
        null;
      const branch =
        (project as { repoSource?: { branch?: string | null } | null } | null | undefined)?.repoSource?.branch ??
        (project as { sourceControl?: { defaultBranch?: string | null } | null } | null | undefined)?.sourceControl?.defaultBranch ??
        undefined;
'''
new_repo = '''      const canonicalRepo = (project as {
        repo?: { provider?: string | null; url?: string | null; defaultBranch?: string | null } | null
        sourceControl?: { provider?: string | null; repoUrl?: string | null; defaultBranch?: string | null } | null
      } | null | undefined)?.repo ?? null;
      const repoUrl = canonicalRepo?.url?.trim() ||
        (project as { sourceControl?: { repoUrl?: string | null } | null } | null | undefined)?.sourceControl?.repoUrl ??
        null;
      const branch = canonicalRepo?.defaultBranch?.trim() ||
        (project as { sourceControl?: { defaultBranch?: string | null } | null } | null | undefined)?.sourceControl?.defaultBranch ??
        undefined;
      const githubAuthorized = canonicalRepo?.provider?.trim().toLowerCase() === "github";
'''
if old_repo not in layout: raise SystemExit("ProjectLayout repository resolution anchor missing")
layout = layout.replace(old_repo, new_repo, 1)
old_clone = '''          case "clone": {
            if (!repoUrl) {
              appToast.warning({ title: t("workspace.noRepoUrl") });
              break;
            }
            const cloneResult = await window.electronAPI.workspace!.cloneForProject({
              projectId,
              slug,
              repoUrl,
              branch,
              setActive: true,
            });
            if (cloneResult.success) {
              refreshWorkspace();
            } else {
              appToast.error({
                title: t("workspace.cloneFailed"),
                description: cloneResult.error ?? undefined,
              });
            }
            break;
          }
'''
new_clone = '''          case "clone": {
            if (githubAuthorized) {
              await downloadAuthorizedProjectRepository({ projectId, slug });
              refreshWorkspace();
              break;
            }
            if (!repoUrl) {
              appToast.warning({ title: t("workspace.noRepoUrl") });
              break;
            }
            const cloneResult = await window.electronAPI.workspace!.cloneForProject({
              projectId,
              slug,
              repoUrl,
              branch,
              setActive: true,
            });
            if (cloneResult.success) {
              refreshWorkspace();
            } else {
              appToast.error({
                title: t("workspace.cloneFailed"),
                description: cloneResult.error ?? undefined,
              });
            }
            break;
          }
'''
if old_clone not in layout: raise SystemExit("ProjectLayout clone case anchor missing")
layout = layout.replace(old_clone, new_clone, 1)
layout_path.write_text(layout)

print("PR141 phase 4 authorized project materialization port applied")

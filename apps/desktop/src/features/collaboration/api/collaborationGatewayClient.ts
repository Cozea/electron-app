import { getDeviceGatewayBaseUrl, getDeviceSession } from "@/lib/deviceSession"
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
      candidate?.payload?.message ||
        candidate?.message ||
        candidate?.error ||
        `Request failed (${response.status})`,
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
    credential.provider !== "github" ||
    credential.operation !== args.operation ||
    !credential.token ||
    !credential.cloneUrl ||
    (!Number.isFinite(credential.expiresAt) || credential.expiresAt <= Date.now())
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
  const response = await fetch(
    `https://api.github.com/repos/${credential.fullName}/git/ref/heads/${encodedBranch}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${credential.token}`,
        "x-github-api-version": "2022-11-28",
      },
    },
  )
  const result = await parseResponse<{ object?: { sha?: string } }>(response)
  const commitSha = result.object?.sha?.trim().toLowerCase() ?? ""
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error("GitHub did not return an exact branch commit")
  }
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

export function repositoryGitAuthOptions(
  credential: CollaborationRepositoryCredentialResponse,
): {
  provider: "github"
  extraHeader: string
} {
  return {
    provider: "github",
    extraHeader: createGitHubExtraHeader(credential.token),
  }
}

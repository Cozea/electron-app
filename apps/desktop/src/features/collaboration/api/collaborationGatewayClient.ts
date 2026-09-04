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
        `Collaboration gateway request failed (${response.status})`,
    )
  }
  return payload as T
}

async function authenticatedPost<T>(path: string, body: unknown): Promise<T> {
  const session = await getDeviceSession()
  const response = await fetch(`${getDeviceGatewayBaseUrl()}${path}`, {
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
    !Number.isFinite(credential.expiresAt)
  ) {
    throw new Error("Repository credential response is invalid")
  }
  return credential
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

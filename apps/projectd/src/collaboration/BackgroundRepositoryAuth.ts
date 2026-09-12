import { ConvexHttpClient } from "convex/browser"
import { makeFunctionReference } from "convex/server"
import type { BackgroundDeviceIdentityManager } from "../identity/BackgroundDeviceIdentity"
import type { BackgroundSessionIntent } from "./BackgroundSessionStore"

interface RepositoryToken { token: string; expiresAt: number; repositoryUrl: string; projectId: string }
const issueToken = makeFunctionReference<"action", { publicSessionId: string }, RepositoryToken>("sessionRepositoryCredentials:forPullRequest")
const issueGitToken = makeFunctionReference<"action", { publicSessionId: string }, RepositoryToken>("sessionRepositoryCredentials:forGitWrite")

/** Credentials live only in this call and the GitHub client's request headers. */
export async function getBackgroundRepositoryToken(
  descriptor: BackgroundSessionIntent,
  expected: { owner: string; repository: string },
  manager: BackgroundDeviceIdentityManager,
  purpose: "pull_request" | "git_write" = "pull_request",
): Promise<string> {
  try {
    for (const value of [descriptor.background.gatewayUrl, descriptor.background.convexUrl]) {
      const url = new URL(value)
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid background service")
    }
    const identity = await manager.loadExistingIdentity()
    const auth = await manager.authenticateWithCloud(descriptor.background.gatewayUrl, fetch, identity)
    const client = new ConvexHttpClient(descriptor.background.convexUrl, {
      fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) }),
    })
    client.setAuth(auth.token)
    const issued = await client.action(purpose === "git_write" ? issueGitToken : issueToken, { publicSessionId: descriptor.publicSessionId })
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(issued.repositoryUrl)
    if (!match || match[1]!.toLowerCase() !== expected.owner.toLowerCase() || match[2]!.toLowerCase() !== expected.repository.toLowerCase() ||
      issued.projectId !== descriptor.projectId || typeof issued.token !== "string" || !issued.token || issued.token.length > 16000 ||
      !Number.isFinite(issued.expiresAt) || issued.expiresAt <= Date.now() + 30_000 || issued.expiresAt > Date.now() + 65 * 60_000) {
      throw new Error("Repository credential scope or expiry changed")
    }
    return issued.token
  } catch { throw new Error("Background repository authorization is unavailable. Verify the project's GitHub App binding and retry.") }
}

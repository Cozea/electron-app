import { ConvexHttpClient } from "convex/browser"
import { makeFunctionReference } from "convex/server"
import { isSameGitHubRepository, parseGitHubRepository } from "@shared/git/githubRepository"
import { RepositoryNotAuthorizedError } from "../git/ScopedNetworkGit"
import type { BackgroundDeviceIdentityManager } from "../identity/BackgroundDeviceIdentity"
import type { BackgroundSessionIntent } from "./BackgroundSessionStore"

interface RepositoryToken { token: string; expiresAt: number; repositoryUrl: string; projectId: string }
interface RepositoryCapabilities { pullRequest: boolean; gitWrite: boolean; repositoryUrl: string; projectId: string }
const issueToken = makeFunctionReference<"action", { publicSessionId: string }, RepositoryToken>("sessionRepositoryCredentials:forPullRequest")
const issueGitToken = makeFunctionReference<"action", { publicSessionId: string }, RepositoryToken>("sessionRepositoryCredentials:forGitWrite")
const discoverCapabilities = makeFunctionReference<"action", { publicSessionId: string }, RepositoryCapabilities>("sessionRepositoryCredentials:capabilities")

function validateServices(descriptor: BackgroundSessionIntent): void {
  for (const value of [descriptor.background.gatewayUrl, descriptor.background.convexUrl]) {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid background service")
  }
}

function assertRepositoryScope(
  repositoryUrl: string,
  projectId: string,
  descriptor: BackgroundSessionIntent,
  expected: { owner: string; repository: string },
): void {
  // Same parser as the PR provider and the scoped network Git layer, so all
  // three agree on which remotes name an authorizable repository.
  const parsed = parseGitHubRepository(repositoryUrl)
  if (!parsed || !isSameGitHubRepository(parsed, expected) ||
    projectId !== descriptor.projectId) throw new Error("Repository credential scope changed")
}

async function authenticatedClient(descriptor: BackgroundSessionIntent, manager: BackgroundDeviceIdentityManager) {
  validateServices(descriptor)
  const identity = await manager.loadExistingIdentity()
  const auth = await manager.authenticateWithCloud(descriptor.background.gatewayUrl, fetch, identity)
  const client = new ConvexHttpClient(descriptor.background.convexUrl, {
    fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) }),
  })
  client.setAuth(auth.token)
  return client
}

async function discoverRepositoryCapabilities(
  descriptor: BackgroundSessionIntent,
  expected: { owner: string; repository: string },
  manager: BackgroundDeviceIdentityManager,
): Promise<{ pullRequest: boolean; gitWrite: boolean }> {
  const client = await authenticatedClient(descriptor, manager)
  const result = await client.action(discoverCapabilities, { publicSessionId: descriptor.publicSessionId })
  assertRepositoryScope(result.repositoryUrl, result.projectId, descriptor, expected)
  if (typeof result.pullRequest !== "boolean" || typeof result.gitWrite !== "boolean") throw new Error("Invalid capabilities")
  return { pullRequest: result.pullRequest, gitWrite: result.gitWrite }
}

/** Capability discovery validates the same binding as issuance but never mints a GitHub token. */
export async function getBackgroundRepositoryCapabilities(
  descriptor: BackgroundSessionIntent,
  expected: { owner: string; repository: string },
  manager: BackgroundDeviceIdentityManager,
): Promise<{ pullRequest: boolean; gitWrite: boolean }> {
  try {
    return await discoverRepositoryCapabilities(descriptor, expected, manager)
  } catch {
    return { pullRequest: false, gitWrite: false }
  }
}

/** Credentials live only in this call and the GitHub client's request headers. */
export async function getBackgroundRepositoryToken(
  descriptor: BackgroundSessionIntent,
  expected: { owner: string; repository: string },
  manager: BackgroundDeviceIdentityManager,
  purpose: "pull_request" | "git_write" = "pull_request",
): Promise<string> {
  try {
    const client = await authenticatedClient(descriptor, manager)
    const issued = await client.action(purpose === "git_write" ? issueGitToken : issueToken, { publicSessionId: descriptor.publicSessionId })
    assertRepositoryScope(issued.repositoryUrl, issued.projectId, descriptor, expected)
    if (typeof issued.token !== "string" || !issued.token || issued.token.length > 16000 ||
      !Number.isFinite(issued.expiresAt) || issued.expiresAt <= Date.now() + 30_000 || issued.expiresAt > Date.now() + 65 * 60_000) {
      throw new Error("Repository credential scope or expiry changed")
    }
    return issued.token
  } catch {
    // Only a confirmed answer that this repository isn't set up is worth telling apart;
    // anything else, including failing to ask, may pass on its own.
    if (purpose === "git_write" &&
      (await discoverRepositoryCapabilities(descriptor, expected, manager).catch(() => null))?.gitWrite === false) {
      throw new RepositoryNotAuthorizedError(expected)
    }
    throw new Error("Background repository authorization is unavailable. Verify the project's GitHub App binding and retry.")
  }
}

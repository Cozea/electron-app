#!/usr/bin/env bun
import { getProjectdSocketPath } from "@cozea/projectd-protocol"
import { GitHubSessionPullRequest } from "./autogit/GitHubSessionPullRequest"
import { SessionPullRequestStore } from "./autogit/SessionPullRequestStore"
import { getBackgroundRepositoryCapabilities, getBackgroundRepositoryToken } from "./collaboration/BackgroundRepositoryAuth"
import { BackgroundSessionStore, type BackgroundSessionIntent } from "./collaboration/BackgroundSessionStore"
import { BackgroundDeviceIdentityManager, type StoredDeviceIdentity } from "./identity/BackgroundDeviceIdentity"
import { ProjectdServer } from "./server/ProjectdServer"
import { ProjectdDatabase } from "./storage/Database"

async function main(): Promise<void> {
  const socketPath = getProjectdSocketPath()
  const database = new ProjectdDatabase()
  const backgroundIdentity = new BackgroundDeviceIdentityManager()
  const backgroundStore = new BackgroundSessionStore(database)
  const pullRequestStore = new SessionPullRequestStore(database)

  const activeSession = async (projectId: string, publicSessionId: string): Promise<{
    identity: StoredDeviceIdentity
    descriptor: BackgroundSessionIntent
  }> => {
    const identity = await backgroundIdentity.loadExistingIdentity()
    if (backgroundStore.accessState(publicSessionId, identity).denied) throw new Error("Session access was revoked")
    const descriptor = backgroundStore.findActive(publicSessionId, identity)
    if (!descriptor || descriptor.projectId !== projectId) throw new Error("Session background access is unavailable")
    return { identity, descriptor }
  }

  const authorizationUnchanged = async (
    publicSessionId: string,
    identity: StoredDeviceIdentity,
  ): Promise<boolean> => {
    const after = await backgroundIdentity.loadExistingIdentity()
    return after.identityKey === identity.identityKey &&
      !backgroundStore.accessState(publicSessionId, after).denied &&
      Boolean(backgroundStore.findActive(publicSessionId, after))
  }

  const server = new ProjectdServer({
    socketPath,
    database,
    backgroundIdentity,
    sessionPullRequests: (projectId, publicSessionId) => new GitHubSessionPullRequest({
      publicSessionId,
      store: pullRequestStore,
      getRepositoryCapabilities: async (scope) => {
        try {
          const { identity, descriptor } = await activeSession(projectId, publicSessionId)
          const capabilities = await getBackgroundRepositoryCapabilities(descriptor, scope, backgroundIdentity)
          return await authorizationUnchanged(publicSessionId, identity)
            ? capabilities
            : { pullRequest: false, gitWrite: false }
        } catch {
          return { pullRequest: false, gitWrite: false }
        }
      },
      getRepositoryToken: async (scope) => {
        const { identity, descriptor } = await activeSession(projectId, publicSessionId)
        const token = await getBackgroundRepositoryToken(descriptor, scope, backgroundIdentity, "pull_request")
        if (!(await authorizationUnchanged(publicSessionId, identity))) throw new Error("Session authorization changed")
        return token
      },
    }),
  })

  console.log(`[projectd] Starting cozea-projectd on ${socketPath} (pid: ${process.pid})`)

  const shutdown = async (signal: string) => {
    console.log(`[projectd] Received ${signal}, shutting down gracefully...`)
    await server.stop()
    process.exit(0)
  }

  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))

  try {
    await server.start()
    console.log(`[projectd] Ready and listening on ${socketPath}`)
  } catch (err) {
    console.error("[projectd] Failed to start:", err)
    process.exit(1)
  }
}

void main()


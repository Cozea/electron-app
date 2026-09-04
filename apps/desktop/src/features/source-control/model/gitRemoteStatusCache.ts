import type { GitRemoteSnapshot } from "@/features/collaboration/model/connectionStatusModel"

interface CachedGitRemoteStatus {
  workspaceId: string
  snapshot: GitRemoteSnapshot
  updatedAt: number
}

const cacheByWorkspace = new Map<string, CachedGitRemoteStatus>()
const listeners = new Set<() => void>()

export function publishGitRemoteStatus(
  workspaceId: string | null | undefined,
  snapshot: GitRemoteSnapshot | null,
): void {
  const key = workspaceId?.trim()
  if (!key) return

  if (!snapshot) {
    if (cacheByWorkspace.delete(key)) {
      for (const listener of listeners) listener()
    }
    return
  }

  const previous = cacheByWorkspace.get(key)
  if (
    previous &&
    previous.snapshot.ahead === snapshot.ahead &&
    previous.snapshot.behind === snapshot.behind &&
    (previous.snapshot.error ?? null) === (snapshot.error ?? null)
  ) {
    return
  }

  cacheByWorkspace.set(key, {
    workspaceId: key,
    snapshot: {
      ahead: snapshot.ahead,
      behind: snapshot.behind,
      error: snapshot.error ?? null,
    },
    updatedAt: Date.now(),
  })

  for (const listener of listeners) listener()
}

export function readGitRemoteStatus(
  workspaceId: string | null | undefined,
): GitRemoteSnapshot | null {
  const key = workspaceId?.trim()
  if (!key) return null
  return cacheByWorkspace.get(key)?.snapshot ?? null
}

export function subscribeGitRemoteStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

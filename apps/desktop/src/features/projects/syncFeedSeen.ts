export function getSyncFeedSeenStorageKey(projectSlug: string): string {
  return `sync-feed-last-seen-${projectSlug}`
}

export function getSyncFeedLastSeen(projectSlug: string): number {
  if (!projectSlug) return 0
  const stored = localStorage.getItem(getSyncFeedSeenStorageKey(projectSlug))
  const parsed = stored ? Number.parseInt(stored, 10) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

export function markSyncFeedAsSeen(projectSlug: string): void {
  if (!projectSlug) return
  localStorage.setItem(
    getSyncFeedSeenStorageKey(projectSlug),
    Date.now().toString()
  )
}

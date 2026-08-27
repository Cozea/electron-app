import { useSyncExternalStore } from "react"

import {
  readGitRemoteStatus,
  subscribeGitRemoteStatus,
} from "@/features/projects/lib/gitRemoteStatusCache"
import type { GitRemoteSnapshot } from "@/features/projects/lib/connectionStatusModel"

export function useGitRemoteStatus(
  workspaceId: string | null | undefined,
): GitRemoteSnapshot | null {
  return useSyncExternalStore(
    subscribeGitRemoteStatus,
    () => readGitRemoteStatus(workspaceId),
    () => null,
  )
}

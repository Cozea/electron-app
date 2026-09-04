import { useSyncExternalStore } from "react"

import {
  readGitRemoteStatus,
  subscribeGitRemoteStatus,
} from "@/features/source-control/model/gitRemoteStatusCache"
import type { GitRemoteSnapshot } from "@/features/collaboration/model/connectionStatusModel"

export function useGitRemoteStatus(
  workspaceId: string | null | undefined,
): GitRemoteSnapshot | null {
  return useSyncExternalStore(
    subscribeGitRemoteStatus,
    () => readGitRemoteStatus(workspaceId),
    () => null,
  )
}

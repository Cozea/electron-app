import { useCallback, useMemo } from "react"
import type { Id } from "../../../../convex/_generated/dataModel"
import type { YjsProjectDoc } from "@/lib/yjs/YjsProjectDoc"

/**
 * Compatibility shape for the pre-generation-3 delete-conflict UI.
 * Live-session recovery now belongs to the Electron collaboration runtime.
 */
export interface DeleteConflict {
  filePath: string
  deletedBy: string | null
  deletedAt: number
  localContent: string
}

/**
 * The plaintext-era reconnect protocol has been retired.
 *
 * Local workspace Yjs documents do not perform network reconciliation here;
 * explicit live sessions recover through the encrypted generation-3 runtime,
 * durable outbox and sequenced room replay in the Electron main process.
 */
export function useReconnectionSync(
  _projectId: Id<"projects"> | null,
  _yjsDoc: YjsProjectDoc | null,
): {
  deleteConflicts: DeleteConflict[]
  resolveConflict: (filePath: string, keepLocal: boolean) => Promise<void>
} {
  const deleteConflicts = useMemo<DeleteConflict[]>(() => [], [])
  const resolveConflict = useCallback(async (_filePath: string, _keepLocal: boolean) => {}, [])
  return { deleteConflicts, resolveConflict }
}

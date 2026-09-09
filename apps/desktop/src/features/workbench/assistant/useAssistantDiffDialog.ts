import { useCallback, useState } from "react"
import type { OrchestrationGetTurnDiffResult } from "@cozea/assistant-contracts"

import {
  type DiffDialogState,
  toErrorMessage,
} from "@/features/workbench/assistant/workbenchAssistantShared"

interface OpenAssistantDiffDialogInput {
  title: string
  request: () => Promise<OrchestrationGetTurnDiffResult>
}

export function useAssistantDiffDialog() {
  const [diffDialog, setDiffDialog] = useState<DiffDialogState | null>(null)

  const openDiffDialog = useCallback(async (input: OpenAssistantDiffDialogInput) => {
    setDiffDialog({ title: input.title, diff: "", error: null, isLoading: true })
    try {
      const result = await input.request()
      setDiffDialog({ title: input.title, diff: result.diff, error: null, isLoading: false })
    } catch (error) {
      setDiffDialog({
        title: input.title,
        diff: "",
        error: toErrorMessage(error),
        isLoading: false,
      })
    }
  }, [])

  const closeDiffDialog = useCallback(() => setDiffDialog(null), [])

  return { closeDiffDialog, diffDialog, openDiffDialog }
}

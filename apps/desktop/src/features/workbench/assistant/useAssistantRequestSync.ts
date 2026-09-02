import { useCallback, useRef, useState } from "react"

import { toErrorMessage } from "./workbenchAssistantShared"

interface RunAssistantRequestSyncOptions {
  requestKey?: string
}

export function useAssistantRequestSync() {
  const [activeRequestKey, setActiveRequestKey] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const activeRequestKeysRef = useRef<Set<string>>(new Set())

  const runRequestSync = useCallback(
    async (
      mutate: () => Promise<void>,
      options?: RunAssistantRequestSyncOptions,
    ) => {
      if (options?.requestKey) {
        if (activeRequestKeysRef.current.has(options.requestKey)) {
          return
        }
        activeRequestKeysRef.current.add(options.requestKey)
        setActiveRequestKey(options.requestKey)
      }

      setRequestError(null)
      try {
        await mutate()
      } catch (error) {
        setRequestError(toErrorMessage(error))
      } finally {
        if (options?.requestKey) {
          activeRequestKeysRef.current.delete(options.requestKey)
          setActiveRequestKey(null)
        }
      }
    },
    [],
  )

  return {
    activeRequestKey,
    requestError,
    runRequestSync,
  }
}

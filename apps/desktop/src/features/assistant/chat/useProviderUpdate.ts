import { useCallback, useRef, useState } from "react"

import type { ProviderDriverKind, ServerProvider } from "@cozea/assistant-contracts"

import { updateAssistantProvider } from "@/features/assistant/model/assistantRuntimeMetadataStore"

type ProviderUpdateState = NonNullable<ServerProvider["updateState"]>

/**
 * Runs the updater and, only when a new version actually landed, hands over to
 * `onInstalled`. That is where the stale session gets replaced: nothing loads
 * the new binary until the old process is gone.
 */
export async function applyProviderUpdate(
  update: () => Promise<ProviderUpdateState | null>,
  onInstalled?: () => Promise<void>,
): Promise<ProviderUpdateState | null> {
  const state = await update()
  if (state?.status === "succeeded") {
    await onInstalled?.()
  }
  return state
}

export interface ProviderUpdateController {
  /** The installed provider is behind the latest release. */
  updateAvailable: boolean
  /** Cozea can run the updater itself, rather than pointing at a command. */
  canUpdate: boolean
  isUpdating: boolean
  error: string | null
  /** Outcome worth showing: the updater failed, or changed nothing. */
  feedback: ProviderUpdateState | null
  run: () => Promise<void>
}

export function useProviderUpdate(
  status: ServerProvider | null,
  options?: { onInstalled?: () => Promise<void> },
): ProviderUpdateController {
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ProviderUpdateState | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const onInstalledRef = useRef(options?.onInstalled)
  onInstalledRef.current = options?.onInstalled

  const updateAvailable = status?.versionAdvisory?.status === "behind_latest"
  const state = result ?? status?.updateState ?? null

  const run = useCallback(async () => {
    if (!status) return
    setIsUpdating(true)
    setError(null)
    setResult(null)
    try {
      setResult(
        await applyProviderUpdate(
          () =>
            updateAssistantProvider(
              status.driver ?? ((status.provider ?? status.driver) as ProviderDriverKind),
              status.instanceId,
            ),
          onInstalledRef.current,
        ),
      )
    } catch (updateError: unknown) {
      setError(updateError instanceof Error ? updateError.message : "Provider update failed.")
    } finally {
      setIsUpdating(false)
    }
  }, [status])

  return {
    updateAvailable: Boolean(updateAvailable),
    canUpdate: Boolean(updateAvailable && status?.versionAdvisory?.canUpdate),
    isUpdating,
    error,
    feedback: state?.status === "failed" || state?.status === "unchanged" ? state : null,
    run,
  }
}

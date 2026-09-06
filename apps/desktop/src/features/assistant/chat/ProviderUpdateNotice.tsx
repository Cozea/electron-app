import { HugeiconsIcon } from "@hugeicons/react"
import {
  AlertCircleIcon as __CircleAlertIconHugeIcon,
  Copy01Icon as __CopyIconHugeIcon,
} from "@hugeicons/core-free-icons"

import { PROVIDER_DISPLAY_NAMES, type ServerProvider } from "@cozea/assistant-contracts"
import { memo, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"
import { presentProviderStatusMessage } from "@/features/assistant/chat/providerStatusPresentation"
import { useProviderUpdate } from "@/features/assistant/chat/useProviderUpdate"

export function resolveProviderLabel(status: ServerProvider | null): string {
  const provider = (status?.provider ?? status?.driver) as keyof typeof PROVIDER_DISPLAY_NAMES
  return (
    PROVIDER_DISPLAY_NAMES[provider] ?? status?.displayName ?? status?.driver ?? "This provider"
  )
}

/**
 * A tile that already holds a conversation must not become a dead end when its
 * provider falls behind. This strip keeps the saved history visible and offers
 * the update in place. The agent restarts as part of that update, so the strip
 * simply disappears once the new version is live.
 */
export const ProviderUpdateNotice = memo(function ProviderUpdateNotice({
  status,
  isTurnRunning,
  onRestartAgent,
}: {
  status: ServerProvider | null
  /** The restart ends the session, so a turn in flight has to finish first. */
  isTurnRunning: boolean
  /**
   * Ends the live session so the next turn starts on the installed version.
   * Runs automatically once the update lands.
   */
  onRestartAgent?: () => Promise<void>
}) {
  const update = useProviderUpdate(status, {
    onInstalled: onRestartAgent
      ? async () => {
          try {
            await onRestartAgent()
          } catch (error: unknown) {
            throw new Error(
              `${resolveProviderLabel(status)} was updated, but the running agent could not be restarted. ${
                error instanceof Error ? error.message : "Send a message to start a new session."
              }`,
            )
          }
        }
      : undefined,
  })
  const { copyToClipboard, isCopied } = useCopyToClipboard()

  const providerLabel = resolveProviderLabel(status)
  const latestVersion = status?.versionAdvisory?.latestVersion ?? null
  const currentVersion = status?.versionAdvisory?.currentVersion ?? status?.version ?? null
  const updateCommand = status?.versionAdvisory?.updateCommand ?? null

  // Updating restarts the agent, which would cut a turn off mid flight.
  const callToAction = isTurnRunning
    ? "Update it once this turn finishes."
    : "Update it to keep using this chat."
  const headline = latestVersion
    ? `${currentVersion ? `${providerLabel} ${currentVersion}` : providerLabel} is behind ${latestVersion}. ${callToAction}`
    : `${providerLabel} is behind its latest release. ${callToAction}`

  return (
    <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/5">
      <div
        role="status"
        className="flex min-w-0 items-center gap-2 px-4 py-3 text-xs leading-normal text-amber-700 dark:text-amber-500"
      >
        <HugeiconsIcon icon={__CircleAlertIconHugeIcon} className="h-3.5 w-3.5 shrink-0" />
        <span className="line-clamp-2 min-w-0 flex-1">
          {presentProviderStatusMessage(headline)}
        </span>
        {update.canUpdate ? (
          <Button
            type="button"
            size="sm"
            className="h-7 shrink-0"
            disabled={update.isUpdating || isTurnRunning}
            onClick={() => {
              void update.run()
            }}
          >
            {update.isUpdating ? <div className="loader mr-1.5" /> : null}
            {update.isUpdating ? "Updating…" : `Update ${providerLabel}`}
          </Button>
        ) : updateCommand ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 font-mono"
            onClick={() => copyToClipboard(updateCommand, undefined)}
          >
            <HugeiconsIcon icon={__CopyIconHugeIcon} className="h-3.5 w-3.5" />
            {isCopied ? "Copied" : updateCommand}
          </Button>
        ) : null}
      </div>
      <ProviderUpdateOutcome error={update.error} feedback={update.feedback} />
    </div>
  )
})

function ProviderUpdateOutcome({
  error,
  feedback,
}: {
  error: string | null
  feedback: NonNullable<ServerProvider["updateState"]> | null
}): ReactNode {
  if (error) {
    return (
      <p className="px-4 pb-2 text-xs text-destructive" role="status">
        {presentProviderStatusMessage(error)}
      </p>
    )
  }
  if (!feedback) return null
  return (
    <div className="px-4 pb-2" role="status" aria-live="polite">
      <p
        className={
          feedback.status === "failed"
            ? "text-xs text-destructive"
            : "text-xs text-muted-foreground"
        }
      >
        {presentProviderStatusMessage(feedback.message ?? "The provider version did not change.")}
      </p>
      {feedback.output ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Update details</summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border/50 bg-secondary/95 p-2.5 font-mono text-[11px]">
            {feedback.output}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

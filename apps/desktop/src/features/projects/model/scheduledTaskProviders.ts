import { defaultInstanceIdForDriver, type ProviderDriverKind, type ProviderInstanceId, type ProviderKind } from "@cozea/assistant-contracts"
import type { ScheduledTaskProvider } from "@shared/scheduledTasks"

/** The library's provider ids are not the assistant's; Claude is the only one that differs. */
export const SCHEDULED_TASK_PROVIDER_KINDS: Record<ScheduledTaskProvider, ProviderKind> = {
  claude: "claudeAgent",
  codex: "codex",
  cursor: "cursor",
  opencode: "opencode",
}

/** The instance a scheduled run uses: a provider's default one. */
export function scheduledTaskInstanceId(provider: ScheduledTaskProvider): ProviderInstanceId {
  return defaultInstanceIdForDriver(
    SCHEDULED_TASK_PROVIDER_KINDS[provider] as ProviderDriverKind,
  )
}

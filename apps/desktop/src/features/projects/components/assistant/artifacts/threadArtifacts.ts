import type { OrchestrationThreadActivity, TurnId } from "@cozea/assistant-contracts"

export type ThreadArtifactStatus = "inProgress" | "completed" | "failed" | "cancelled"

export interface ThreadImageArtifact {
  id: string
  kind: "image"
  threadId: string
  turnId: TurnId | null
  status: ThreadArtifactStatus
  title: string
  prompt: string | null
  mimeType: string | null
  available: boolean
  startedAt: string
  completedAt: string | null
  durationMs: number | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeStatus(value: unknown, activityKind: string): ThreadArtifactStatus {
  const status = asString(value)
  if (status === "completed") return "completed"
  if (status === "failed" || status === "declined") return "failed"
  if (status === "cancelled" || status === "canceled") return "cancelled"
  if (activityKind === "tool.completed") return "completed"
  return "inProgress"
}

function terminalStatus(status: ThreadArtifactStatus): boolean {
  return status !== "inProgress"
}

function finiteDuration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Fold the append-only provider activity lifecycle into one thread-scoped
 * image artifact per stable tool-call id. Completion metadata replaces the
 * generic start label without adding a second gallery entry.
 */
export function deriveThreadImageArtifacts(
  threadId: string | null | undefined,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ThreadImageArtifact[] {
  if (!threadId) return []

  const byId = new Map<string, ThreadImageArtifact>()
  for (const activity of activities) {
    const payload = asRecord(activity.payload)
    const data = asRecord(payload?.data)
    const artifact = asRecord(data?.artifact)
    if (payload?.itemType !== "image_generation" || artifact?.kind !== "image") continue

    const id = asString(artifact.id) ?? asString(payload.toolCallId)
    if (!id) continue

    const status = normalizeStatus(artifact.status ?? payload.status, activity.kind)
    const previous = byId.get(id)
    const durationMs = finiteDuration(payload.durationMs) ?? previous?.durationMs ?? null
    const activityTimestamp = Date.parse(activity.createdAt)
    const inferredStartedAt =
      !previous && durationMs !== null && Number.isFinite(activityTimestamp)
        ? new Date(Math.max(0, activityTimestamp - durationMs)).toISOString()
        : activity.createdAt

    byId.set(id, {
      id,
      kind: "image",
      threadId,
      turnId: activity.turnId ?? previous?.turnId ?? null,
      status,
      title:
        asString(artifact.title) ??
        previous?.title ??
        (status === "inProgress" ? "Generating image" : "Generated image"),
      prompt: asString(artifact.prompt) ?? previous?.prompt ?? null,
      mimeType: asString(artifact.mimeType) ?? previous?.mimeType ?? null,
      available: artifact.available === true || previous?.available === true,
      startedAt: previous?.startedAt ?? inferredStartedAt,
      completedAt: terminalStatus(status) ? activity.createdAt : null,
      durationMs,
    })
  }

  return Array.from(byId.values()).sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt),
  )
}

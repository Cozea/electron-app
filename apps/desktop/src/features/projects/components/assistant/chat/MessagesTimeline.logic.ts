import type { OrchestrationThreadActivity, TurnId } from "@cozea/assistant-contracts";

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

export type GenerationStatusPhase = "thinking" | "working";

/**
 * Explicit provider reasoning is the only state that renders as Thinking.
 * Active turns otherwise render as Working, including providers that do not
 * expose reasoning lifecycle events.
 */
export function deriveGenerationStatusPhase(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  activeTurnId: TurnId | null | undefined,
): GenerationStatusPhase {
  if (!activeTurnId) return "working";
  const markers = activities
    .filter((activity) => activity.turnId === activeTurnId)
    .filter(
      (activity) =>
        activity.kind === "reasoning.started" || activity.kind === "reasoning.completed",
    )
    .sort((left, right) => {
      if (left.sequence !== undefined && right.sequence !== undefined) {
        return left.sequence - right.sequence;
      }
      const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
      if (createdAtOrder !== 0) return createdAtOrder;
      if (left.kind !== right.kind) return left.kind === "reasoning.started" ? -1 : 1;
      return left.id.localeCompare(right.id);
    });
  return markers.at(-1)?.kind === "reasoning.started" ? "thinking" : "working";
}

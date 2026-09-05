import type { OrchestrationThreadActivity, TurnId } from "@cozea/assistant-contracts";
import { isInternalActivity } from "@/features/assistant/chat/activityOwnership";
import { compareActivitiesByOrder, deriveActivePlanState } from "./session-logic";

export interface ProviderTaskActivity {
  taskId: string;
  turnId: TurnId | null;
  title: string;
  status: string;
  detail?: string;
  agentKind?: string;
  agentId?: string;
  parentAgentId?: string;
  toolUseId?: string;
  role?: string;
  model?: string;
  isBackgrounded?: boolean;
  /** Retain native diagnostics including usage, phases, errors and run handles. */
  payload: Record<string, unknown>;
  /** Presentation-only group, not a synthesized provider task lifecycle. */
  presentationKind?: "activity-group";
  activities?: readonly OrchestrationThreadActivity[];
}

/** Compact native lifecycle groups; retain every original payload for inspection. */
export function groupOwnedActivity(activities: readonly OrchestrationThreadActivity[]) {
  const groups = new Map<
    string,
    { latest: OrchestrationThreadActivity; events: OrchestrationThreadActivity[] }
  >();
  for (const event of activities) {
    const data = event.payload as Record<string, unknown> | null;
    const identity = event.kind.startsWith("task.")
      ? data?.taskId
      : (data?.toolCallId ?? data?.itemId);
    const key = typeof identity === "string" ? `${event.kind.split(".")[0]}:${identity}` : event.id;
    const previous = groups.get(key);
    const previousData = previous?.latest.payload as Record<string, unknown> | undefined;
    const settled =
      previous &&
      ["completed", "failed", "stopped", "cancelled", "declined", "interrupted"].includes(
        String(previousData?.status),
      );
    const events = previous?.events ?? [];
    events.push(event);
    groups.set(key, {
      latest:
        settled &&
        (event.kind.endsWith(".progress") ||
          (data?.status === undefined && !event.kind.endsWith(".started")))
          ? previous.latest
          : event,
      events,
    });
  }
  return [...groups.entries()].map(([id, group]) => ({ id, ...group }));
}

/** Fold only provider-persisted task identity; task prose is never reasoning. */
export function deriveProviderActivityState(
  activities: readonly OrchestrationThreadActivity[],
  turnId?: TurnId | null,
) {
  const tasks = new Map<string, ProviderTaskActivity>();
  let reasoningActive = false;
  for (const activity of [...activities].sort(compareActivitiesByOrder)) {
    if (turnId && activity.turnId !== turnId) continue;
    const internal = isInternalActivity(activity);
    if (!internal && activity.kind === "reasoning.started") reasoningActive = true;
    if (!internal && activity.kind === "reasoning.completed") reasoningActive = false;
    if (!activity.kind.startsWith("task.")) continue;
    const payload = activity.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
    const data = payload as Record<string, unknown>;
    if (typeof data.taskId !== "string") continue;
    const previous = tasks.get(data.taskId);
    const merged = { ...previous?.payload, ...data };
    const text = (key: string) =>
      typeof merged[key] === "string" ? (merged[key] as string) : undefined;
    const explicitStatus = typeof data.status === "string" ? data.status : undefined;
    const status =
      explicitStatus ??
      previous?.status ??
      (activity.kind === "task.started" || activity.kind === "task.progress"
        ? "running"
        : "unknown");
    const terminal =
      previous && ["completed", "failed", "stopped", "cancelled"].includes(previous.status);
    tasks.set(data.taskId, {
      taskId: data.taskId,
      turnId: previous ? previous.turnId : (activity.turnId ?? null),
      title: text("title") ?? previous?.title ?? text("detail") ?? "Provider task",
      // A usage-only tick or delayed progress must not resurrect a terminal task.
      status: terminal && activity.kind === "task.progress" ? previous.status : status,
      detail: text("summary") ?? text("detail"),
      agentKind: text("agentKind"),
      agentId: text("agentId"),
      parentAgentId: text("parentAgentId"),
      toolUseId: text("toolUseId"),
      role: text("role"),
      model: text("model"),
      ...(typeof merged.isBackgrounded === "boolean"
        ? { isBackgrounded: merged.isBackgrounded }
        : {}),
      payload: merged,
    });
  }
  return {
    reasoningActive,
    tasks: [...tasks.values()],
    plan: deriveActivePlanState(
      activities.filter((event) => !isInternalActivity(event)),
      turnId ?? undefined,
    ),
  };
}

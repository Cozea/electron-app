import type { OrchestrationThreadActivity } from "@cozea/assistant-contracts";
import {
  compareActivitiesByOrder,
  deriveActivePlanState,
  type ActivePlanState,
  type TimelineEntry,
} from "./session-logic";
import { deriveProviderActivityState, type ProviderTaskActivity } from "./providerActivity";

export interface ConversationActivityEntries {
  entries: TimelineEntry[];
  tasks: ReadonlyMap<string, ProviderTaskActivity>;
  plans: ReadonlyMap<string, ActivePlanState>;
  rehomedActivityIds?: ReadonlySet<string>;
}

/** Fold native lifecycle updates at their original chronological anchor. */
export function projectActivityEntries(
  activities: readonly OrchestrationThreadActivity[],
): ConversationActivityEntries {
  const ordered = [...activities].sort(compareActivitiesByOrder);
  const taskState = deriveProviderActivityState(ordered);
  const firstTasks = new Map<string, OrchestrationThreadActivity>();
  const planGroups = new Map<string, OrchestrationThreadActivity[]>();
  for (const activity of ordered) {
    if (activity.kind.startsWith("task.")) {
      const payload = activity.payload as Record<string, unknown> | null;
      if (typeof payload?.taskId === "string" && !firstTasks.has(payload.taskId))
        firstTasks.set(payload.taskId, activity);
    }
    if (activity.kind === "turn.plan.updated") {
      const key = activity.turnId ?? "no-turn";
      const group = planGroups.get(key) ?? [];
      group.push(activity);
      planGroups.set(key, group);
    }
  }
  const entries: TimelineEntry[] = [];
  const tasks = new Map<string, ProviderTaskActivity>();
  const plans = new Map<string, ActivePlanState>();
  const rehomedActivityIds = new Set<string>();
  const owned = new Map<string, OrchestrationThreadActivity[]>();
  const taskById = new Map(taskState.tasks.map((task) => [task.taskId, task]));
  const groups = new Map<string, ProviderTaskActivity>();
  const nestedBackgroundTasks = new Set<string>();
  for (const event of ordered) {
    const data = event.payload as Record<string, unknown> | null;
    if (!data) continue;
    const taskId = typeof data.taskId === "string" ? data.taskId : undefined;
    const lifecycle = event.kind.startsWith("task.") && taskId !== undefined;
    const ownerValue = lifecycle ? taskById.get(taskId!)?.agentId : data.agentId;
    const owner = typeof ownerValue === "string" && ownerValue.trim() ? ownerValue : undefined;
    // Native agent lifecycle remains a spawn anchor, even for bypassed/nested agents.
    const nestedAnchor = lifecycle && taskById.get(taskId!)?.agentKind === "agent";
    // Pending request controls remain in their existing independently actionable surface.
    if (event.kind.startsWith("request.")) continue;
    let target = lifecycle && (!owner || nestedAnchor || !taskById.has(owner)) ? taskId : owner;
    const seen = new Set<string>();
    while (target && !seen.has(target)) {
      seen.add(target);
      const candidate = taskById.get(target);
      if (
        candidate?.agentKind === "agent" ||
        !candidate?.agentId ||
        !taskById.has(candidate.agentId)
      )
        break;
      target = candidate.agentId;
    }
    if (!lifecycle && !owner && data.timelineBypass !== true) continue;
    if (!target || !taskById.has(target)) {
      target = `internal:${event.turnId ?? "no-turn"}:${target ?? "unattributed"}`;
      if (!groups.has(target))
        groups.set(target, {
          taskId: target,
          turnId: event.turnId ?? null,
          title: owner ? `Activity for unavailable agent ${owner}` : "Internal activity",
          status: "Activity",
          presentationKind: "activity-group",
          payload: {},
        });
    }
    if (lifecycle && target !== taskId) nestedBackgroundTasks.add(taskId!);
    const events = owned.get(target) ?? [];
    events.push(event);
    owned.set(target, events);
    rehomedActivityIds.add(event.id);
  }
  for (const original of [...taskState.tasks, ...groups.values()]) {
    const task = { ...original, activities: owned.get(original.taskId) ?? [] };
    // Owned background tasks live inside their owner's disclosure, not the parent narrative.
    if (nestedBackgroundTasks.has(task.taskId)) continue;
    const first = firstTasks.get(task.taskId) ?? task.activities[0];
    if (!first) continue;
    const id = `provider-task:${task.taskId}`;
    tasks.set(id, task);
    entries.push({
      kind: "work",
      id,
      createdAt: first.createdAt,
      entry: {
        id,
        createdAt: first.createdAt,
        turnId: task.turnId,
        taskId: task.taskId,
        label: task.title,
        tone: "info",
        sourceActivityKind: "task.started",
        toolData: task.payload,
      },
    });
  }
  for (const [key, group] of planGroups) {
    const parentGroup = group.filter((event) => !rehomedActivityIds.has(event.id));
    const first = parentGroup[0];
    if (!first) continue;
    const plan = deriveActivePlanState(parentGroup, first.turnId ?? undefined);
    if (!plan) continue;
    const id = `provider-plan:${key}`;
    plans.set(id, plan);
    entries.push({
      kind: "work",
      id,
      createdAt: first.createdAt,
      entry: {
        id,
        createdAt: first.createdAt,
        turnId: plan.turnId,
        label: "Agent plan",
        tone: "info",
        sourceActivityKind: "turn.plan.updated",
      },
    });
  }
  return { entries, tasks, plans, rehomedActivityIds };
}

export function mergeActivityEntries(
  entries: readonly TimelineEntry[],
  activity: ConversationActivityEntries,
): TimelineEntry[] {
  const result = entries.filter((entry) => {
    if (entry.kind !== "work") return true;
    if (
      activity.rehomedActivityIds?.has(entry.id) ||
      activity.rehomedActivityIds?.has(entry.entry.id)
    )
      return false;
    const kind = entry.entry.sourceActivityKind ?? entry.entry.activityKind;
    if (entry.entry.taskId && activity.tasks.has(`provider-task:${entry.entry.taskId}`))
      return false;
    if (
      kind === "turn.plan.updated" &&
      activity.plans.has(`provider-plan:${entry.entry.turnId ?? "no-turn"}`)
    )
      return false;
    return true;
  });
  return [...result, ...activity.entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

import {
  ApprovalRequestId,
  isToolLifecycleItemType,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  type OrchestrationProposedPlanId,
  type ProviderKind,
  type ToolLifecycleItemType,
  type UserInputQuestion,
  type ThreadId,
  type TurnId,
} from "@cozea/assistant-contracts";

import type {
  ChatMessage,
  ProposedPlan,
  SessionPhase,
  Thread,
  ThreadSession,
  TurnDiffSummary,
} from "@/features/assistant/model/types";
import { truncateTextToWidth } from "@/lib/text/pretextMeasure";

export type ProviderPickerKind = ProviderKind;

export const PROVIDER_OPTIONS: ReadonlyArray<{
  value: ProviderPickerKind;
  label: string;
}> = [
  { value: "codex", label: "Codex" },
  { value: "claudeAgent", label: "Claude" },
  { value: "cursor", label: "Cursor" },
  { value: "opencode", label: "OpenCode" },
];

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  turnId?: TurnId | null;
  label: string;
  detail?: string;
  command?: string;
  rawCommand?: string;
  changedFiles?: ReadonlyArray<string>;
  savedFiles?: ReadonlyArray<string>;
  failedFiles?: ReadonlyArray<{
    path: string;
    error?: string;
  }>;
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string;
  itemType?: ToolLifecycleItemType;
  requestKind?: PendingApproval["requestKind"];
  activityKind?: OrchestrationThreadActivity["kind"];
  sourceActivityKind?: OrchestrationThreadActivity["kind"];
  toolCallId?: string;
  toolLifecycleStatus?: "inProgress" | "completed" | "failed" | "declined" | "stopped";
  status?: "inProgress" | "completed" | "failed" | "declined" | "cancelled";
  /** Grouping key for subagent lifecycle rows (one row per agent). Not yet populated. */
  taskId?: string;
  /**
   * Structured tool payload for MCP calls, surfaced in the expanded row. The
   * server projection keeps `item`, `toolName`, `input` and a summarized
   * `result`, which is enough to show what was actually called.
   */
  toolData?: unknown;
}

interface DerivedWorkLogEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity["kind"];
  collapseKey?: string;
  toolCallId?: string;
}

export interface PendingApproval {
  requestId: ApprovalRequestId;
  requestKind: "command" | "file-read" | "file-change";
  createdAt: string;
  detail?: string;
}

export interface PendingUserInput {
  requestId: ApprovalRequestId;
  createdAt: string;
  questions: ReadonlyArray<UserInputQuestion>;
}

export interface ActivePlanState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
}

export type TimelineEntry =
  | {
      id: string;
      kind: "message";
      createdAt: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "proposed-plan";
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      id: string;
      kind: "work";
      createdAt: string;
      entry: WorkLogEntry;
    };

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "0s";
  if (durationMs < 60_000) return `${Math.max(1, Math.round(durationMs / 1_000))}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  if (seconds === 0) return `${minutes}m`;
  if (seconds === 60) return `${minutes + 1}m`;
  return `${minutes}m ${seconds}s`;
}

export function formatElapsed(startIso: string, endIso: string | undefined): string | null {
  if (!endIso) return null;
  const startedAt = Date.parse(startIso);
  const endedAt = Date.parse(endIso);
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) {
    return null;
  }
  return formatDuration(endedAt - startedAt);
}

type LatestTurnTiming = Pick<OrchestrationLatestTurn, "turnId" | "startedAt" | "completedAt">;
type SessionActivityState = Pick<ThreadSession, "orchestrationStatus" | "activeTurnId">;

export function isLatestTurnSettled(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
): boolean {
  if (!latestTurn?.startedAt) return false;
  if (!latestTurn.completedAt) return false;
  if (!session) return true;
  if (session.orchestrationStatus === "running") return false;
  return true;
}

export function deriveActiveWorkStartedAt(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
  sendStartedAt: string | null,
): string | null {
  if (!isLatestTurnSettled(latestTurn, session)) {
    return latestTurn?.startedAt ?? sendStartedAt;
  }
  return sendStartedAt;
}

function requestKindFromRequestType(requestType: unknown): PendingApproval["requestKind"] | null {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return null;
  }
}

function isStalePendingRequestFailureDetail(detail: string | undefined): boolean {
  const normalized = detail?.toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("stale pending approval request") ||
    normalized.includes("stale pending user-input request") ||
    normalized.includes("unknown pending approval request") ||
    normalized.includes("unknown pending permission request") ||
    normalized.includes("unknown pending user-input request") ||
    normalized.includes("no active provider session is bound")
  );
}

export function derivePendingApprovals(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingApproval[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingApproval>();
  const ordered = [...activities].sort(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.makeUnsafe(payload.requestId)
        : null;
    const requestKind =
      payload &&
      (payload.requestKind === "command" ||
        payload.requestKind === "file-read" ||
        payload.requestKind === "file-change")
        ? payload.requestKind
        : payload
          ? requestKindFromRequestType(payload.requestType)
          : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "approval.requested" && requestId && requestKind) {
      openByRequestId.set(requestId, {
        requestId,
        requestKind,
        createdAt: activity.createdAt,
        ...(detail ? { detail } : {}),
      });
      continue;
    }

    if (activity.kind === "approval.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.approval.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
      continue;
    }
  }

  return [...openByRequestId.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function parseUserInputQuestions(
  payload: Record<string, unknown> | null,
): ReadonlyArray<UserInputQuestion> | null {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }
  const parsed = questions
    .map<UserInputQuestion | null>((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const question = entry as Record<string, unknown>;
      if (
        typeof question.id !== "string" ||
        typeof question.header !== "string" ||
        typeof question.question !== "string" ||
        !Array.isArray(question.options)
      ) {
        return null;
      }
      const options = question.options
        .map<UserInputQuestion["options"][number] | null>((option) => {
          if (!option || typeof option !== "object") return null;
          const optionRecord = option as Record<string, unknown>;
          if (
            typeof optionRecord.label !== "string" ||
            typeof optionRecord.description !== "string"
          ) {
            return null;
          }
          return {
            label: optionRecord.label,
            description: optionRecord.description,
          };
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);
      if (options.length === 0) {
        return null;
      }
      return {
        id: question.id,
        header: question.header,
        question: question.question,
        options,
      };
    })
    .filter((question): question is UserInputQuestion => question !== null);
  return parsed.length > 0 ? parsed : null;
}

export function derivePendingUserInputs(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingUserInput[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingUserInput>();
  const ordered = [...activities].sort(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.makeUnsafe(payload.requestId)
        : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "user-input.requested" && requestId) {
      const questions = parseUserInputQuestions(payload);
      if (!questions) {
        continue;
      }
      openByRequestId.set(requestId, {
        requestId,
        createdAt: activity.createdAt,
        questions,
      });
      continue;
    }

    if (activity.kind === "user-input.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.user-input.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
    }
  }

  return [...openByRequestId.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function deriveActivePlanState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): ActivePlanState | null {
  const ordered = [...activities].sort(compareActivitiesByOrder);
  const candidates = ordered.filter((activity) => {
    if (activity.kind !== "turn.plan.updated") {
      return false;
    }
    if (!latestTurnId) {
      return true;
    }
    return activity.turnId === latestTurnId;
  });
  const latest = candidates.at(-1);
  if (!latest) {
    return null;
  }
  const payload =
    latest.payload && typeof latest.payload === "object"
      ? (latest.payload as Record<string, unknown>)
      : null;
  const rawPlan = payload?.plan;
  if (!Array.isArray(rawPlan)) {
    return null;
  }
  const steps = rawPlan
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      if (typeof record.step !== "string") {
        return null;
      }
      const status =
        record.status === "completed" || record.status === "inProgress" ? record.status : "pending";
      return {
        step: record.step,
        status,
      };
    })
    .filter(
      (
        step,
      ): step is {
        step: string;
        status: "pending" | "inProgress" | "completed";
      } => step !== null,
    );
  if (steps.length === 0) {
    return null;
  }
  return {
    createdAt: latest.createdAt,
    turnId: latest.turnId,
    ...(payload && "explanation" in payload
      ? { explanation: payload.explanation as string | null }
      : {}),
    steps,
  };
}

export function findLatestProposedPlan(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  latestTurnId: TurnId | string | null | undefined,
): LatestProposedPlanState | null {
  if (latestTurnId) {
    const matchingTurnPlan = [...proposedPlans]
      .filter((proposedPlan) => proposedPlan.turnId === latestTurnId)
      .sort(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
      )
      .at(-1);
    if (matchingTurnPlan) {
      return toLatestProposedPlanState(matchingTurnPlan);
    }
  }

  const latestPlan = [...proposedPlans]
    .sort(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
    )
    .at(-1);
  if (!latestPlan) {
    return null;
  }

  return toLatestProposedPlanState(latestPlan);
}

export function findSidebarProposedPlan(input: {
  threads: ReadonlyArray<Pick<Thread, "id" | "proposedPlans">>;
  latestTurn: Pick<OrchestrationLatestTurn, "turnId" | "sourceProposedPlan"> | null;
  latestTurnSettled: boolean;
  threadId: ThreadId | string | null | undefined;
}): LatestProposedPlanState | null {
  const activeThreadPlans =
    input.threads.find((thread) => thread.id === input.threadId)?.proposedPlans ?? [];

  if (!input.latestTurnSettled) {
    const sourceProposedPlan = input.latestTurn?.sourceProposedPlan;
    if (sourceProposedPlan) {
      const sourcePlan = input.threads
        .find((thread) => thread.id === sourceProposedPlan.threadId)
        ?.proposedPlans.find((plan) => plan.id === sourceProposedPlan.planId);
      if (sourcePlan) {
        return toLatestProposedPlanState(sourcePlan);
      }
    }
  }

  return findLatestProposedPlan(activeThreadPlans, input.latestTurn?.turnId ?? null);
}

export function hasActionableProposedPlan(
  proposedPlan: LatestProposedPlanState | Pick<ProposedPlan, "implementedAt"> | null,
): boolean {
  return proposedPlan !== null && proposedPlan.implementedAt === null;
}

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): WorkLogEntry[] {
  const ordered = [...activities].sort(compareActivitiesByOrder);
  const entries = ordered
    .filter((activity) => (latestTurnId ? activity.turnId === latestTurnId : true))
    .filter((activity) => activity.kind !== "task.started")
    .filter((activity) => activity.kind !== "tool.progress")
    .filter((activity) => activity.kind !== "context-window.updated")
    .filter((activity) => activity.kind !== "account.rate-limits.updated")
    .filter(
      (activity) =>
        activity.kind !== "reasoning.started" && activity.kind !== "reasoning.completed",
    )
    .filter((activity) => activity.summary !== "Checkpoint captured")
    .filter((activity) => !isPlanBoundaryToolActivity(activity))
    .map(toDerivedWorkLogEntry);
  return collapseDerivedWorkLogEntries(entries).map(({ collapseKey: _collapseKey, ...entry }) => entry);
}

function isPlanBoundaryToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
    return false;
  }

  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  return typeof payload?.detail === "string" && payload.detail.startsWith("ExitPlanMode:");
}

function toDerivedWorkLogEntry(activity: OrchestrationThreadActivity): DerivedWorkLogEntry {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const commandPreview = extractToolCommand(payload);
  const changedFiles = extractChangedFiles(payload);
  const persistedFiles = extractPersistedFiles(payload);
  const title = extractToolTitle(payload);
  const status = extractWorkLogStatus(payload);
  const isTaskActivity = activity.kind === "task.progress" || activity.kind === "task.completed";
  const isToolProgressActivity =
    activity.kind === "tool.progress" || activity.kind === "tool.summary";
  const isPersistedFilesActivity = activity.kind === "files.persisted";
  const runtimeDetail = extractRuntimeActivityDetail(activity.kind, payload, changedFiles);
  const taskSummary =
    isTaskActivity && typeof payload?.summary === "string" && payload.summary.length > 0
      ? payload.summary
      : null;
  const taskDetailAsLabel =
    isTaskActivity &&
    !taskSummary &&
    typeof payload?.detail === "string" &&
    payload.detail.length > 0
      ? payload.detail
      : null;
  const taskLabel = taskSummary || taskDetailAsLabel;
  const detail = isTaskActivity
    ? !taskDetailAsLabel &&
      payload &&
      typeof payload.detail === "string" &&
      payload.detail.length > 0
      ? stripTrailingExitCode(payload.detail).output
      : null
    : isToolProgressActivity
      ? extractToolProgressDetail(payload)
      : isPersistedFilesActivity
        ? extractPersistedFilesDetail(payload)
        : (runtimeDetail ?? extractToolDetail(payload, title ?? activity.summary));
  const toolCallId = isTaskActivity ? null : extractToolCallId(payload);
  const label =
    taskLabel ??
    deriveRuntimeActivityLabel({
      activityKind: activity.kind,
      activitySummary: activity.summary,
      payload,
    });
  const entry: DerivedWorkLogEntry = {
    id: activity.id,
    createdAt: activity.createdAt,
    turnId: activity.turnId,
    label,
    tone:
      activity.kind === "task.progress"
        ? "thinking"
        : status === "failed" || (isPersistedFilesActivity && persistedFiles.failedFiles.length > 0)
          ? "error"
          : status === "cancelled" || status === "declined"
            ? "info"
            : activity.tone === "approval"
              ? "info"
              : activity.tone,
    activityKind: activity.kind,
    sourceActivityKind: activity.kind,
  };
  const itemType = extractWorkLogItemType(payload);
  const requestKind = extractWorkLogRequestKind(payload);
  if (detail) {
    entry.detail = detail;
  }
  if (commandPreview.command) {
    entry.command = commandPreview.command;
  }
  if (commandPreview.rawCommand) {
    entry.rawCommand = commandPreview.rawCommand;
  }
  if (changedFiles.length > 0) {
    entry.changedFiles = changedFiles;
  }
  if (persistedFiles.savedFiles.length > 0) {
    entry.savedFiles = persistedFiles.savedFiles;
  }
  if (persistedFiles.failedFiles.length > 0) {
    entry.failedFiles = persistedFiles.failedFiles;
  }
  if (title) {
    entry.toolTitle = title;
  }
  if (itemType) {
    entry.itemType = itemType;
  }
  if (itemType === "mcp_tool_call" && payload?.data !== undefined) {
    entry.toolData = payload.data;
  }
  if (status) {
    entry.status = status;
    entry.toolLifecycleStatus = status === "cancelled" ? "stopped" : status;
  } else if (activity.kind === "tool.completed") {
    entry.toolLifecycleStatus = "completed";
  }
  if (requestKind) {
    entry.requestKind = requestKind;
  }
  if (toolCallId) {
    entry.toolCallId = toolCallId;
  }
  const collapseKey = deriveToolLifecycleCollapseKey(entry);
  if (collapseKey) {
    entry.collapseKey = collapseKey;
  }
  return entry;
}

function collapseDerivedWorkLogEntries(
  entries: ReadonlyArray<DerivedWorkLogEntry>,
): DerivedWorkLogEntry[] {
  const collapsed: DerivedWorkLogEntry[] = [];
  const toolLifecycleRowIndex = new Map<string, number>();
  for (const entry of entries) {
    const lifecycleKey = toolLifecycleCollapseMapKey(entry);
    if (lifecycleKey) {
      const matchingIndex = toolLifecycleRowIndex.get(lifecycleKey);
      const matchingEntry = matchingIndex === undefined ? undefined : collapsed[matchingIndex];
      if (
        matchingIndex !== undefined &&
        matchingEntry &&
        shouldCollapseToolLifecycleEntries(matchingEntry, entry)
      ) {
        collapsed[matchingIndex] = mergeDerivedWorkLogEntries(matchingEntry, entry);
        if (entry.activityKind === "tool.completed") {
          toolLifecycleRowIndex.delete(lifecycleKey);
        }
        continue;
      }
      toolLifecycleRowIndex.delete(lifecycleKey);
    }
    const previous = collapsed.at(-1);
    if (previous && shouldCollapseToolLifecycleEntries(previous, entry)) {
      const previousIndex = collapsed.length - 1;
      const previousKey = toolLifecycleCollapseMapKey(previous);
      if (previousKey) toolLifecycleRowIndex.delete(previousKey);
      const merged = mergeDerivedWorkLogEntries(previous, entry);
      collapsed[previousIndex] = merged;
      const mergedKey = toolLifecycleCollapseMapKey(merged);
      if (mergedKey && merged.activityKind !== "tool.completed") {
        toolLifecycleRowIndex.set(mergedKey, previousIndex);
      }
      continue;
    }
    collapsed.push(entry);
    if (lifecycleKey && entry.activityKind !== "tool.completed") {
      toolLifecycleRowIndex.set(lifecycleKey, collapsed.length - 1);
    }
  }
  return collapsed;
}

function toolLifecycleCollapseMapKey(entry: DerivedWorkLogEntry): string | undefined {
  if (
    entry.activityKind !== "tool.started" &&
    entry.activityKind !== "tool.updated" &&
    entry.activityKind !== "tool.completed"
  ) {
    return undefined;
  }
  return entry.toolCallId ? `tool:${entry.turnId ?? "no-turn"}:${entry.toolCallId}` : undefined;
}

function shouldCollapseToolLifecycleEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (previous.turnId !== next.turnId) {
    return false;
  }
  if (
    previous.activityKind !== "tool.started" &&
    previous.activityKind !== "tool.updated" &&
    previous.activityKind !== "tool.completed"
  ) {
    return false;
  }
  if (
    next.activityKind !== "tool.started" &&
    next.activityKind !== "tool.updated" &&
    next.activityKind !== "tool.completed"
  ) {
    return false;
  }
  if (previous.activityKind === "tool.completed") {
    return false;
  }
  if (previous.collapseKey !== undefined && previous.collapseKey === next.collapseKey) {
    return true;
  }
  return (
    previous.toolCallId !== undefined &&
    next.toolCallId === undefined &&
    previous.itemType === next.itemType &&
    normalizeCompactToolLabel(previous.toolTitle ?? previous.label) ===
      normalizeCompactToolLabel(next.toolTitle ?? next.label)
  );
}

function mergeDerivedWorkLogEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  const changedFiles = mergeChangedFiles(previous.changedFiles, next.changedFiles);
  const detail = next.detail ?? previous.detail;
  const command = next.command ?? previous.command;
  const rawCommand = next.rawCommand ?? previous.rawCommand;
  const toolTitle = next.toolTitle ?? previous.toolTitle;
  const itemType = next.itemType ?? previous.itemType;
  const requestKind = next.requestKind ?? previous.requestKind;
  const collapseKey = next.collapseKey ?? previous.collapseKey;
  const toolCallId = next.toolCallId ?? previous.toolCallId;
  return {
    ...previous,
    ...next,
    ...(detail ? { detail } : {}),
    ...(command ? { command } : {}),
    ...(rawCommand ? { rawCommand } : {}),
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
    ...(toolTitle ? { toolTitle } : {}),
    ...(itemType ? { itemType } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(collapseKey ? { collapseKey } : {}),
    ...(toolCallId ? { toolCallId } : {}),
  };
}

function mergeChangedFiles(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): string[] {
  const merged = [...(previous ?? []), ...(next ?? [])];
  if (merged.length === 0) {
    return [];
  }
  return [...new Set(merged)];
}

function deriveToolLifecycleCollapseKey(entry: DerivedWorkLogEntry): string | undefined {
  if (
    entry.activityKind !== "tool.started" &&
    entry.activityKind !== "tool.updated" &&
    entry.activityKind !== "tool.completed"
  ) {
    return undefined;
  }
  if (entry.toolCallId) {
    return `tool:${entry.toolCallId}`;
  }
  const normalizedLabel = normalizeCompactToolLabel(entry.toolTitle ?? entry.label);
  const detail = entry.detail?.trim() ?? "";
  const itemType = entry.itemType ?? "";
  if (normalizedLabel.length === 0 && detail.length === 0 && itemType.length === 0) {
    return undefined;
  }
  return [itemType, normalizedLabel, detail].join("\u001f");
}

function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

function toLatestProposedPlanState(proposedPlan: ProposedPlan): LatestProposedPlanState {
  return {
    id: proposedPlan.id,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stripTrailingExitCode(value: string): {
  output: string | null;
  exitCode?: number | undefined;
} {
  const trimmed = value.trim();
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(
    trimmed,
  );
  if (!match?.groups) {
    return {
      output: trimmed.length > 0 ? trimmed : null,
    };
  }
  const exitCode = Number.parseInt(match.groups.code ?? "", 10);
  const normalizedOutput = match.groups.output?.trim() ?? "";
  return {
    output: normalizedOutput.length > 0 ? normalizedOutput : null,
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  };
}

function trimMatchingOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted.length > 0 ? unquoted : trimmed;
  }
  return trimmed;
}

function executableBasename(value: string): string | null {
  const trimmed = trimMatchingOuterQuotes(value);
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments.at(-1)?.trim() ?? "";
  return last.length > 0 ? last.toLowerCase() : null;
}

function splitExecutableAndRest(value: string): { executable: string; rest: string } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed.charAt(0);
    const closeIndex = trimmed.indexOf(quote, 1);
    if (closeIndex <= 0) {
      return null;
    }
    return {
      executable: trimmed.slice(0, closeIndex + 1),
      rest: trimmed.slice(closeIndex + 1).trim(),
    };
  }

  const firstWhitespace = trimmed.search(/\s/);
  if (firstWhitespace < 0) {
    return {
      executable: trimmed,
      rest: "",
    };
  }

  return {
    executable: trimmed.slice(0, firstWhitespace),
    rest: trimmed.slice(firstWhitespace).trim(),
  };
}

const SHELL_WRAPPER_SPECS = [
  {
    executables: ["pwsh", "pwsh.exe", "powershell", "powershell.exe"],
    wrapperFlagPattern: /(?:^|\s)-command\s+/i,
  },
  {
    executables: ["cmd", "cmd.exe"],
    wrapperFlagPattern: /(?:^|\s)\/c\s+/i,
  },
  {
    executables: ["bash", "sh", "zsh"],
    wrapperFlagPattern: /(?:^|\s)-(?:l)?c\s+/,
  },
] as const;

function findShellWrapperSpec(shell: string) {
  return SHELL_WRAPPER_SPECS.find((spec) =>
    (spec.executables as ReadonlyArray<string>).includes(shell),
  );
}

function unwrapCommandRemainder(value: string, wrapperFlagPattern: RegExp): string | null {
  const match = wrapperFlagPattern.exec(value);
  if (!match) {
    return null;
  }

  const command = value.slice(match.index + match[0].length).trim();
  if (command.length === 0) {
    return null;
  }

  const unwrapped = trimMatchingOuterQuotes(command);
  return unwrapped.length > 0 ? unwrapped : null;
}

function unwrapKnownShellCommandWrapper(value: string): string {
  const split = splitExecutableAndRest(value);
  if (!split || split.rest.length === 0) {
    return value;
  }

  const shell = executableBasename(split.executable);
  if (!shell) {
    return value;
  }

  const spec = findShellWrapperSpec(shell);
  if (!spec) {
    return value;
  }

  return unwrapCommandRemainder(split.rest, spec.wrapperFlagPattern) ?? value;
}

function formatCommandArrayPart(value: string): string {
  return /[\s"'`]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function formatCommandValue(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== null);
  if (parts.length === 0) {
    return null;
  }
  return parts.map((part) => formatCommandArrayPart(part)).join(" ");
}

function normalizeCommandValue(value: unknown): string | null {
  const formatted = formatCommandValue(value);
  return formatted ? unwrapKnownShellCommandWrapper(formatted) : null;
}

function toRawToolCommand(value: unknown, normalizedCommand: string | null): string | null {
  const formatted = formatCommandValue(value);
  if (!formatted || normalizedCommand === null) {
    return null;
  }
  return formatted === normalizedCommand ? null : formatted;
}

function extractToolCommand(payload: Record<string, unknown> | null): {
  command: string | null;
  rawCommand: string | null;
} {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemResult = asRecord(item?.result);
  const itemInput = asRecord(item?.input);
  const itemType = asTrimmedString(payload?.itemType);
  const detail = asTrimmedString(payload?.detail);
  const candidates: unknown[] = [
    item?.command,
    itemInput?.command,
    itemResult?.command,
    data?.command,
    itemType === "command_execution" && detail ? stripTrailingExitCode(detail).output : null,
  ];

  for (const candidate of candidates) {
    const command = normalizeCommandValue(candidate);
    if (!command) {
      continue;
    }
    return {
      command,
      rawCommand: toRawToolCommand(candidate, command),
    };
  }

  return {
    command: null,
    rawCommand: null,
  };
}

function extractToolCallId(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  return (
    asTrimmedString(payload?.toolCallId) ??
    asTrimmedString(payload?.callID) ??
    asTrimmedString(data?.toolCallId) ??
    asTrimmedString(data?.callID) ??
    asTrimmedString(item?.toolCallId) ??
    asTrimmedString(item?.callID) ??
    asTrimmedString(item?.id)
  );
}

function normalizeInlinePreview(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const INLINE_PREVIEW_FONT = "400 11px Inter";
// Matches timeline preview rows (`text-[11px]`) with a practical single-line width budget.
const INLINE_PREVIEW_MAX_WIDTH_PX = 540;

function truncateInlinePreview(value: string, maxWidth = INLINE_PREVIEW_MAX_WIDTH_PX): string {
  return truncateTextToWidth(value, INLINE_PREVIEW_FONT, maxWidth, {
    suffix: "…",
    pretextOptions: { whiteSpace: "normal" },
  });
}

function normalizePreviewForComparison(value: string | null | undefined): string | null {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return null;
  }
  return normalizeCompactToolLabel(normalizeInlinePreview(normalized)).toLowerCase();
}

function summarizeToolTextOutput(value: string): string | null {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => normalizeInlinePreview(line))
    .filter((line) => line.length > 0);
  const firstLine = lines.find((line) => line !== "```");
  if (firstLine) {
    return truncateInlinePreview(firstLine);
  }
  if (lines.length > 1) {
    return `${lines.length.toLocaleString()} lines`;
  }
  return null;
}

function summarizeToolRawOutput(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const rawOutput = asRecord(data?.rawOutput);
  if (!rawOutput) {
    return null;
  }

  const totalFiles = asNumber(rawOutput.totalFiles);
  if (totalFiles !== null) {
    const suffix = rawOutput.truncated === true ? "+" : "";
    return `${totalFiles.toLocaleString()} file${totalFiles === 1 ? "" : "s"}${suffix}`;
  }

  const content = asTrimmedString(rawOutput.content);
  if (content) {
    return summarizeToolTextOutput(content);
  }

  const stdout = asTrimmedString(rawOutput.stdout);
  if (stdout) {
    return summarizeToolTextOutput(stdout);
  }

  return null;
}

function isCommandToolDetail(payload: Record<string, unknown> | null, heading: string): boolean {
  const data = asRecord(payload?.data);
  const kind = asTrimmedString(data?.kind)?.toLowerCase();
  const title = asTrimmedString(payload?.title ?? heading)?.toLowerCase();
  return (
    extractWorkLogItemType(payload) === "command_execution" ||
    kind === "execute" ||
    title === "terminal" ||
    title === "ran command"
  );
}

function extractToolDetail(
  payload: Record<string, unknown> | null,
  heading: string,
): string | null {
  const rawDetail = asTrimmedString(payload?.detail);
  let detail = rawDetail ? stripTrailingExitCode(rawDetail).output : null;

  if (detail && /^[\s[\]{}",:]+$/.test(detail)) {
    detail = null;
  }

  const normalizedHeading = normalizePreviewForComparison(heading);
  const normalizedDetail = normalizePreviewForComparison(detail);

  if (detail && normalizedHeading !== normalizedDetail) {
    return detail;
  }

  if (isCommandToolDetail(payload, heading)) {
    return null;
  }

  const rawOutputSummary = summarizeToolRawOutput(payload);
  if (rawOutputSummary) {
    const normalizedRawOutputSummary = normalizePreviewForComparison(rawOutputSummary);
    if (normalizedRawOutputSummary !== normalizedHeading) {
      return rawOutputSummary;
    }
  }

  return null;
}

function extractToolTitle(payload: Record<string, unknown> | null): string | null {
  if (payload?.itemType === "image_generation") {
    const artifact = asRecord(asRecord(payload.data)?.artifact);
    const artifactTitle = asTrimmedString(artifact?.title);
    if (artifactTitle) {
      const status = asTrimmedString(artifact?.status) ?? asTrimmedString(payload.status);
      return status === "inProgress"
        ? `Generating ${artifactTitle}`
        : `Generated ${artifactTitle}`;
    }
  }
  return asTrimmedString(payload?.title);
}

function extractWorkLogItemType(
  payload: Record<string, unknown> | null,
): WorkLogEntry["itemType"] | undefined {
  if (typeof payload?.itemType === "string" && isToolLifecycleItemType(payload.itemType)) {
    return payload.itemType;
  }
  return undefined;
}

function extractWorkLogRequestKind(
  payload: Record<string, unknown> | null,
): WorkLogEntry["requestKind"] | undefined {
  if (
    payload?.requestKind === "command" ||
    payload?.requestKind === "file-read" ||
    payload?.requestKind === "file-change"
  ) {
    return payload.requestKind;
  }
  return requestKindFromRequestType(payload?.requestType) ?? undefined;
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "args",
    "resolution",
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "failed",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

function extractChangedFiles(payload: Record<string, unknown> | null): string[] {
  const changedFiles: string[] = [];
  const seen = new Set<string>();
  collectChangedFiles(payload, changedFiles, seen, 0);
  return changedFiles;
}

function extractPersistedFiles(payload: Record<string, unknown> | null): {
  savedFiles: string[];
  failedFiles: Array<{
    path: string;
    error?: string;
  }>;
} {
  const savedFiles: string[] = [];
  const failedFiles: Array<{
    path: string;
    error?: string;
  }> = [];

  if (Array.isArray(payload?.files)) {
    for (const entry of payload.files) {
      const record = asRecord(entry);
      const filename = asTrimmedString(record?.filename);
      if (filename) {
        savedFiles.push(filename);
      }
    }
  }

  if (Array.isArray(payload?.failed)) {
    for (const entry of payload.failed) {
      const record = asRecord(entry);
      const filename = asTrimmedString(record?.filename);
      if (!filename) {
        continue;
      }
      const error = asTrimmedString(record?.error) ?? undefined;
      failedFiles.push(
        error
          ? {
              path: filename,
              error,
            }
          : {
              path: filename,
            },
      );
    }
  }

  return { savedFiles, failedFiles };
}

function normalizeWorkLogStatus(
  value: unknown,
): "inProgress" | "completed" | "failed" | "declined" | "cancelled" | null {
  switch (value) {
    case "in_progress":
    case "inProgress":
    case "pending":
      return "inProgress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "declined":
      return "declined";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

function extractWorkLogStatus(
  payload: Record<string, unknown> | null,
): WorkLogEntry["status"] | undefined {
  const directStatus = normalizeWorkLogStatus(payload?.status);
  if (directStatus) {
    return directStatus;
  }
  const data = asRecord(payload?.data);
  return normalizeWorkLogStatus(data?.status) ?? undefined;
}

function extractFirstFailedPersistedFileError(
  payload: Record<string, unknown> | null,
): string | null {
  const failed = payload?.failed;
  if (!Array.isArray(failed)) {
    return null;
  }
  for (const entry of failed) {
    const record = asRecord(entry);
    const filename = asTrimmedString(record?.filename);
    const error = asTrimmedString(record?.error);
    if (filename && error) {
      return `${filename}: ${error}`;
    }
    if (filename) {
      return filename;
    }
    if (error) {
      return error;
    }
  }
  return null;
}

function extractPersistedFilesDetail(payload: Record<string, unknown> | null): string | null {
  const failure = extractFirstFailedPersistedFileError(payload);
  if (failure) {
    return failure;
  }
  const files = Array.isArray(payload?.files) ? payload.files.length : 0;
  return files > 0 ? null : "No files were persisted";
}

function formatElapsedSeconds(value: unknown): string | null {
  const seconds = asNumber(value);
  if (seconds === null || seconds < 0) {
    return null;
  }
  if (seconds >= 60) {
    const wholeSeconds = Math.round(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    const remainder = wholeSeconds % 60;
    return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }
  return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
}

function extractToolProgressDetail(payload: Record<string, unknown> | null): string | null {
  const toolName = asTrimmedString(payload?.toolName);
  const elapsed = formatElapsedSeconds(payload?.elapsedSeconds);
  if (toolName && elapsed) {
    return `${toolName} - ${elapsed}`;
  }
  if (toolName) {
    return toolName;
  }
  return elapsed;
}

function extractRuntimeActivityDetail(
  activityKind: string,
  payload: Record<string, unknown> | null,
  changedFiles: ReadonlyArray<string>,
): string | null {
  switch (activityKind) {
    case "model.rerouted": {
      const fromModel = asTrimmedString(payload?.fromModel);
      const toModel = asTrimmedString(payload?.toModel);
      const reason = asTrimmedString(payload?.reason);
      const route =
        fromModel && toModel ? `${fromModel} -> ${toModel}` : (toModel ?? fromModel ?? null);
      if (route && reason) {
        return `${route} - ${reason}`;
      }
      return route ?? reason;
    }
    case "config.warning":
    case "deprecation.notice": {
      const details = asTrimmedString(payload?.details);
      const path = asTrimmedString(payload?.path);
      return details ?? path;
    }
    case "auth.status": {
      const error = asTrimmedString(payload?.error);
      if (error) {
        return error;
      }
      if (Array.isArray(payload?.output)) {
        const lines = payload.output
          .map((entry) => asTrimmedString(entry))
          .filter((entry): entry is string => entry !== null);
        if (lines.length > 0) {
          return lines[0];
        }
      }
      return null;
    }
    case "approval.requested": {
      const detail = asTrimmedString(payload?.detail);
      if (detail) {
        return detail;
      }
      return changedFiles[0] ?? null;
    }
    case "approval.resolved": {
      return changedFiles[0] ?? null;
    }
    case "mcp.oauth.completed": {
      const name = asTrimmedString(payload?.name);
      const error = asTrimmedString(payload?.error);
      return error ?? name;
    }
    case "runtime.warning": {
      const message = asTrimmedString(payload?.message);
      const detail = asTrimmedString(payload?.detail);
      return detail ?? message;
    }
    case "runtime.error": {
      return asTrimmedString(payload?.message);
    }
    default:
      return null;
  }
}

function deriveRuntimeActivityLabel(input: {
  activityKind: string;
  activitySummary: string;
  payload: Record<string, unknown> | null;
}): string {
  const { activityKind, activitySummary, payload } = input;
  switch (activityKind) {
    case "tool.progress":
      return (
        asTrimmedString(payload?.summary) ??
        (asTrimmedString(payload?.toolName)
          ? `Running ${asTrimmedString(payload?.toolName)}`
          : "Tool in progress")
      );
    case "tool.summary":
      return asTrimmedString(payload?.summary) ?? activitySummary;
    case "files.persisted": {
      const savedCount = Array.isArray(payload?.files) ? payload.files.length : 0;
      const failedCount = Array.isArray(payload?.failed) ? payload.failed.length : 0;
      if (savedCount > 0 && failedCount > 0) {
        return "Saved files with issues";
      }
      if (failedCount > 0) {
        return "Failed to save files";
      }
      return "Saved files";
    }
    case "model.rerouted":
      return "Model rerouted";
    case "config.warning":
      return asTrimmedString(payload?.summary) ?? "Configuration warning";
    case "deprecation.notice":
      return asTrimmedString(payload?.summary) ?? "Deprecation notice";
    case "auth.status":
      return asTrimmedString(payload?.error)
        ? "Authentication failed"
        : payload?.isAuthenticating === true
          ? "Authenticating provider"
          : "Authentication updated";
    case "account.updated":
      return "Account updated";
    case "account.rate-limits.updated":
      return "Rate limits updated";
    case "mcp.status.updated":
      return "MCP status updated";
    case "mcp.oauth.completed":
      return payload?.success === false ? "MCP sign-in failed" : "MCP sign-in completed";
    case "runtime.warning":
      return asTrimmedString(payload?.message) ?? "Runtime warning";
    case "approval.requested":
      return activitySummary;
    case "approval.resolved":
      return activitySummary;
    default:
      return activitySummary;
  }
}

function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const lifecycleRankComparison =
    compareActivityLifecycleRank(left.kind) - compareActivityLifecycleRank(right.kind);
  if (lifecycleRankComparison !== 0) {
    return lifecycleRankComparison;
  }

  return left.id.localeCompare(right.id);
}

function compareActivityLifecycleRank(kind: string): number {
  if (kind.endsWith(".started") || kind === "tool.started") {
    return 0;
  }
  if (kind.endsWith(".progress") || kind.endsWith(".updated")) {
    return 1;
  }
  if (kind.endsWith(".completed") || kind.endsWith(".resolved")) {
    return 2;
  }
  return 1;
}

export function hasToolActivityForTurn(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  turnId: TurnId | null | undefined,
): boolean {
  if (!turnId) return false;
  return activities.some((activity) => activity.turnId === turnId && activity.tone === "tool");
}

export function deriveTimelineEntries(
  messages: ChatMessage[],
  proposedPlans: ProposedPlan[],
  workEntries: WorkLogEntry[],
): TimelineEntry[] {
  const messageRows: TimelineEntry[] = messages.map((message) => ({
    id: message.id,
    kind: "message",
    createdAt: message.createdAt,
    message,
  }));
  const proposedPlanRows: TimelineEntry[] = proposedPlans.map((proposedPlan) => ({
    id: proposedPlan.id,
    kind: "proposed-plan",
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  }));
  const workRows: TimelineEntry[] = workEntries.map((entry) => ({
    id: entry.id,
    kind: "work",
    createdAt: entry.createdAt,
    entry,
  }));
  return [...messageRows, ...proposedPlanRows, ...workRows].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export function inferCheckpointTurnCountByTurnId(
  summaries: TurnDiffSummary[],
): Record<TurnId, number> {
  const sorted = [...summaries].sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  const result: Record<TurnId, number> = {};
  for (let index = 0; index < sorted.length; index += 1) {
    const summary = sorted[index];
    if (!summary) continue;
    result[summary.turnId] = index + 1;
  }
  return result;
}

export function derivePhase(session: ThreadSession | null): SessionPhase {
  if (!session || session.status === "closed") return "disconnected";
  if (session.status === "connecting") return "connecting";
  if (session.status === "running") return "running";
  if (session.status === "interrupted") return "interrupted";
  if (session.status === "stopped") return "stopped";
  if (session.status === "error") return "error";
  return "ready";
}

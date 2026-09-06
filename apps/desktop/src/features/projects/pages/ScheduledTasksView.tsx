import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ClaudeAI,
  CursorIcon,
  OpenAI,
  OpenCodeIcon,
  type Icon,
} from "@/features/assistant/Icons";
import { scheduledTasksSnapshot, useScheduledTasksSnapshot } from "@/features/projects/model/scheduledTasksSnapshot";
import { useWorkspaceCatalogSnapshot } from "@/features/workspace/useWorkspaceCatalogSnapshot";
import { ScheduledTaskDetail } from "@/features/projects/pages/ScheduledTaskDetail";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { useAssistantComposerDraftStore } from "@/features/assistant/chat/composerDraftStore";
import { useAssistantRuntimeMetadata } from "@/features/assistant/model/assistantRuntimeMetadataStore";
import { useSubstrateChatTransport } from "@/substrate/useSubstrateChatTransport";
import { useT3ServerConfigCutover } from "@/substrate/useT3ServerConfigCutover";
import { getProviderModelCapabilities } from "@/features/assistant/model/providerModels";
import {
  getProviderModelOptions,
  getProviderSnapshot,
} from "@/features/workbench/assistant/workbenchAssistantShared";
import {
  SCHEDULED_TASK_PROVIDER_KINDS,
  scheduledTaskInstanceId,
} from "@/features/projects/model/scheduledTaskProviders";
import {
  getModelSelectionOptionDescriptors,
  normalizeModelSlug,
} from "@cozea/assistant-shared/model";
import { DEFAULT_MODEL_BY_PROVIDER } from "@cozea/assistant-contracts";
import { appToast } from "@/lib/appToast";
import { useSearchParams } from "@/lib/router";
import { useProjectHeader } from "@/lib/useProjectHeader";
import { cn } from "@/lib/utils";
import {
  computeNextRunAt,
  describeRecurrence,
  normalizeRecurrence,
  RUN_ONCE,
  SCHEDULED_TASK_PROVIDERS,
  type ScheduledTask,
  type ScheduledTaskDraft,
  normalizeModelOptions,
  type ScheduledTaskModelOption,
  type ScheduledTaskProjectTarget,
  type ScheduledTaskProvider,
  type ScheduledTaskRecurrence,
  type ScheduledTaskRecurrenceUnit,
} from "@shared/scheduledTasks";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon as __AddHugeIcon,
  ArrowLeft01Icon as __ArrowLeftHugeIcon,
  Clock01Icon as __ClockHugeIcon,
  ComputerIcon as __ComputerHugeIcon,
  Delete02Icon as __DeleteHugeIcon,
  PauseIcon as __PauseHugeIcon,
  PencilEdit02Icon as __EditHugeIcon,
  PlayIcon as __PlayHugeIcon,
  FolderLibraryIcon as __ProjectHugeIcon,
  Search01Icon as __SearchHugeIcon,
  SunriseIcon as __SunriseHugeIcon,
  CheckListIcon as __CheckListHugeIcon,
  PackageIcon as __PackageHugeIcon,
  BinocularsIcon as __BinocularsHugeIcon,
  Idea01Icon as __IdeaHugeIcon,
  News01Icon as __NewsHugeIcon,
} from "@hugeicons/core-free-icons";

const PROVIDER_LABELS: Record<ScheduledTaskProvider, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
};

const PROVIDER_ICONS: Record<ScheduledTaskProvider, Icon> = {
  claude: ClaudeAI,
  codex: OpenAI,
  cursor: CursorIcon,
  opencode: OpenCodeIcon,
};

/** The repeat control's own vocabulary: one row in the picker per phrase. */
type RepeatChoice = "once" | ScheduledTaskRecurrenceUnit;

const REPEAT_CHOICES: ReadonlyArray<{ id: RepeatChoice; label: string; unitNoun: string }> = [
  // One word each. The interval field beside this says how many, so the label
  // does not have to carry "or every few".
  { id: "once", label: "Once", unitNoun: "" },
  { id: "hours", label: "Hourly", unitNoun: "hours" },
  { id: "days", label: "Daily", unitNoun: "days" },
  { id: "weeks", label: "Weekly", unitNoun: "weeks" },
  { id: "months", label: "Monthly", unitNoun: "months" },
];

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatRunTime(value: number): string {
  return DATE_TIME_FORMAT.format(new Date(value));
}

/** Two halves of a native date and time pair, in the viewer's own zone. */
export function splitLocalDateTime(value: number): { date: string; time: string } {
  const at = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

/** Null when either half is missing or the pair is not a real instant. */
export function joinLocalDateTime(date: string, time: string): number | null {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${time}`);
  const value = parsed.getTime();
  return Number.isFinite(value) ? value : null;
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const RELATIVE_FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const RELATIVE_STEPS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: "minute", ms: 60_000 },
  { unit: "hour", ms: 60 * 60_000 },
  { unit: "day", ms: 24 * 60 * 60_000 },
  { unit: "week", ms: 7 * 24 * 60 * 60_000 },
  { unit: "month", ms: 30 * 24 * 60 * 60_000 },
];

/** "in 10 hours", "in 3 days" — the coarsest unit that still says something. */
export function describeDistance(from: number, to: number): string {
  const delta = to - from;
  const magnitude = Math.abs(delta);
  let step = RELATIVE_STEPS[0]!;
  for (const candidate of RELATIVE_STEPS) {
    if (magnitude >= candidate.ms) step = candidate;
  }
  const value = Math.round(delta / step.ms);
  return RELATIVE_FORMAT.format(value, step.unit);
}

/** How often the task runs, in the words the list uses: "Daily at 9:00 AM". */
export function describeCadence(task: Pick<ScheduledTask, "recurrence" | "startAt">): string {
  const at = TIME_FORMAT.format(new Date(task.startAt));
  const { recurrence } = task;
  if (!recurrence.unit) return `Once on ${formatRunTime(task.startAt)}`;
  if (recurrence.unit === "hours") return describeRecurrence(recurrence);
  if (recurrence.unit === "days" && recurrence.interval === 1) return `Daily at ${at}`;
  return `${describeRecurrence(recurrence)} at ${at}`;
}

/** The state half of the line: when it next runs, or why it never will. */
export function describeNextRun(task: ScheduledTask, now: number = Date.now()): string {
  if (!task.enabled) return "Paused";
  const nextRunAt = computeNextRunAt(task);
  if (nextRunAt === null) return "Completed";
  if (nextRunAt < now) return "Overdue";
  return `Next run ${describeDistance(now, nextRunAt)}`;
}

/** The one line under a task: how often it runs, and when that next is. */
export function describeSchedule(task: ScheduledTask, now: number = Date.now()): string {
  return `${describeCadence(task)} · ${describeNextRun(task, now)}`;
}

export type ScheduledTaskFilter = "all" | "active" | "paused" | "completed";

export const SCHEDULED_TASK_FILTERS: ReadonlyArray<{ id: ScheduledTaskFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "completed", label: "Completed" },
];

export function matchesFilter(task: ScheduledTask, filter: ScheduledTaskFilter): boolean {
  if (filter === "all") return true;
  if (filter === "paused") return !task.enabled;
  // A one-time task that has run owes nothing more; that is what "completed"
  // means here, and a paused task is never counted as either.
  const finished = computeNextRunAt({ ...task, enabled: true }) === null;
  if (filter === "completed") return task.enabled && finished;
  return task.enabled && !finished;
}

export function matchesTaskSearch(task: ScheduledTask, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    task.name.toLowerCase().includes(needle) ||
    task.prompt.toLowerCase().includes(needle) ||
    (task.project?.label.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * Starter tasks. Clicking one opens the form filled in, exactly as an agent's
 * proposal does, so a suggestion is a head start rather than a hidden save.
 */
export interface ScheduledTaskSuggestion {
  id: string;
  name: string;
  description: string;
  /** What the cadence reads as, written to match the recurrence below. */
  cadence: string;
  icon: typeof __SunriseHugeIcon;
  prompt: string;
  hour: number;
  /** 0 is Sunday. Set when the suggestion names a day, like "every Friday". */
  weekday?: number;
  recurrence: ScheduledTaskRecurrence;
  /** True for a task that belongs to no project. */
  general?: boolean;
}

export const SCHEDULED_TASK_SUGGESTIONS: ReadonlyArray<ScheduledTaskSuggestion> = [
  {
    id: "daily-briefing",
    name: "Daily briefing",
    description: "What changed in this project overnight, and what needs your attention today.",
    cadence: "Every day at 8:00 AM",
    icon: __SunriseHugeIcon,
    prompt:
      "Summarize what changed in this project since yesterday: commits, open branches, and anything left unfinished. Keep it short and lead with what needs attention.",
    hour: 8,
    recurrence: { unit: "days", interval: 1 },
  },
  {
    id: "weekly-review",
    name: "Weekly review",
    description: "A Friday summary of what shipped, what is in progress, and what is blocked.",
    cadence: "Every Friday at 4:00 PM",
    icon: __CheckListHugeIcon,
    prompt:
      "Read this week's commits and write a short status update: what shipped, what is in progress, and what is blocked.",
    hour: 16,
    weekday: 5,
    recurrence: { unit: "weeks", interval: 1 },
  },
  {
    id: "dependency-watch",
    name: "Dependency watch",
    description: "Check for outdated or vulnerable packages and flag the ones worth updating.",
    cadence: "Every Monday at 9:00 AM",
    icon: __PackageHugeIcon,
    prompt:
      "Check this project's dependencies for outdated or vulnerable packages. List the ones worth updating, most important first, with the reason for each.",
    hour: 9,
    weekday: 1,
    recurrence: { unit: "weeks", interval: 1 },
  },
  {
    id: "monitor-topic",
    name: "Monitor a topic",
    description: "Watch for news or mentions of a topic, competitor, or keyword.",
    cadence: "Every day at 9:00 AM",
    icon: __BinocularsHugeIcon,
    prompt:
      "Search the web for news about <topic> from the last day and summarize anything genuinely new. Say so plainly when there is nothing worth reporting.",
    hour: 9,
    recurrence: { unit: "days", interval: 1 },
    general: true,
  },
  {
    id: "content-ideas",
    name: "Content ideas",
    description: "Draft a few post ideas each week from the latest news in your industry.",
    cadence: "Every Monday at 9:00 AM",
    icon: __IdeaHugeIcon,
    prompt:
      "Look at this week's news in <industry> and draft three short post ideas, each with an angle and a first line.",
    hour: 9,
    weekday: 1,
    recurrence: { unit: "weeks", interval: 1 },
    general: true,
  },
  {
    id: "release-notes",
    name: "Release notes",
    description: "Turn the week's merged work into notes you can publish.",
    cadence: "Every Friday at 5:00 PM",
    icon: __NewsHugeIcon,
    prompt:
      "Draft release notes from this week's merged commits, grouped by user-visible change, in plain language.",
    hour: 17,
    weekday: 5,
    recurrence: { unit: "weeks", interval: 1 },
  },
];

const NO_PROJECT = "__none__";
const NO_PROJECT_LABEL = "No project";

export function basenameOf(pathValue: string): string {
  const trimmed = pathValue.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

/**
 * The reasoning level, and nothing else the model happens to expose.
 *
 * Same ids the composer's own model picker treats as effort, so the two agree
 * as providers rename things. Options like the context window are deliberately
 * left out: a schedule is about how hard the run thinks, not how it is framed.
 */
export function isReasoningDescriptor(descriptor: { id: string }): boolean {
  const id = descriptor.id.toLowerCase();
  return id === "effort" || id === "reasoningeffort" || id === "reasoning" || id === "thinking";
}

/**
 * The models to offer, with the current one always among them.
 *
 * The catalog comes from the provider's own snapshot, which needs the local
 * agent runtime, and that is not always up on this page. An empty select is an
 * unusable one, so the current model is offered even when nothing else is.
 */
export function modelChoicesFor(
  serverModels: ReadonlyArray<{ slug: string; name: string }>,
  selectedModel: string,
): ReadonlyArray<{ slug: string; name: string }> {
  if (serverModels.some((option) => option.slug === selectedModel)) return serverModels;
  return [{ slug: selectedModel, name: selectedModel }, ...serverModels];
}

/**
 * The projects a task can be pointed at.
 *
 * A Cozea project, plus the local checkout it resolves to. Driving this off the
 * project list rather than the workspace catalog alone matters: the catalog
 * remembers folders this device has seen, including ones whose project is gone,
 * and offering those would schedule work against a project the user does not have.
 */
export function projectTargets(
  projects: ReadonlyArray<{ _id: string; name: string }> | undefined,
  catalogEntries: Readonly<Record<string, { status: string; workspace: { projectRootPath: string } }>>,
): ScheduledTaskProjectTarget[] {
  const targets: ScheduledTaskProjectTarget[] = [];
  const seenRoots = new Set<string>();
  for (const project of projects ?? []) {
    const entry = catalogEntries[project._id];
    // No local checkout on this device means nowhere for a run to happen.
    if (!entry || entry.status !== "ready") continue;
    const workspaceRoot = entry.workspace.projectRootPath;
    if (!workspaceRoot || seenRoots.has(workspaceRoot)) continue;
    seenRoots.add(workspaceRoot);
    targets.push({ workspaceRoot, label: project.name?.trim() || basenameOf(workspaceRoot) });
  }
  return targets.sort((left, right) => left.label.localeCompare(right.label));
}

function emptyDraft(): ScheduledTaskDraft {
  // Tomorrow at 09:00 is a defensible default: far enough out that saving a
  // half-filled form cannot fire something immediately.
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  const provider: ScheduledTaskProvider = "claude";
  return {
    name: "",
    prompt: "",
    provider,
    // Reading the store directly keeps this callable from event handlers; the
    // value is a remembered preference, not something that has to re-render.
    ...resolveProviderModelDefault(
      provider,
      useAssistantComposerDraftStore.getState().lastModelSelectionByInstanceId,
    ),
    computerUse: false,
    project: null,
    startAt: start.getTime(),
    recurrence: RUN_ONCE,
    enabled: true,
  };
}

/**
 * A draft handed over by an agent tile through the URL. Everything is optional
 * and everything is checked: this arrives from a model's output, so it fills a
 * form for a person to approve, never a saved task.
 */
export function draftFromPrefill(
  encoded: string | null,
  projectTargets: ReadonlyArray<ScheduledTaskProjectTarget>,
): ScheduledTaskDraft | null {
  if (!encoded) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(encoded);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Record<string, unknown>;
  const base = emptyDraft();
  const workspaceRoot =
    typeof candidate.workspaceRoot === "string" ? candidate.workspaceRoot : null;
  const startAt = typeof candidate.startAt === "number" && Number.isFinite(candidate.startAt)
    ? candidate.startAt
    : base.startAt;

  return {
    ...base,
    name: typeof candidate.name === "string" ? candidate.name.slice(0, 120) : "",
    prompt: typeof candidate.prompt === "string" ? candidate.prompt.slice(0, 4000) : "",
    provider: SCHEDULED_TASK_PROVIDERS.includes(candidate.provider as never)
      ? (candidate.provider as ScheduledTaskDraft["provider"])
      : base.provider,
    model: typeof candidate.model === "string" ? candidate.model : null,
    modelOptions: normalizeModelOptions(candidate.modelOptions),
    computerUse: candidate.computerUse === true,
    project: workspaceRoot
      ? projectTargets.find((target) => target.workspaceRoot === workspaceRoot) ?? {
          workspaceRoot,
          label: basenameOf(workspaceRoot),
        }
      : null,
    startAt,
    recurrence: normalizeRecurrence(candidate.recurrence as never),
  };
}

function draftFromTask(task: ScheduledTask): ScheduledTaskDraft {
  return {
    taskId: task.id,
    name: task.name,
    prompt: task.prompt,
    provider: task.provider,
    model: task.model,
    modelOptions: task.modelOptions,
    computerUse: task.computerUse,
    project: task.project,
    startAt: task.startAt,
    recurrence: task.recurrence,
    enabled: task.enabled,
  };
}

/**
 * The model a provider should start on: whatever it was last used with in a
 * chat tile, falling back to the provider's own default. Picking up the last
 * choice is what makes the form feel like a continuation of your own habits
 * rather than a fresh set of defaults every time.
 */
export function resolveProviderModelDefault(
  provider: ScheduledTaskProvider,
  lastByInstanceId: Record<string, { model?: string; options?: ReadonlyArray<ScheduledTaskModelOption> }>,
): { model: string | null; modelOptions: ScheduledTaskModelOption[] } {
  const remembered = lastByInstanceId[scheduledTaskInstanceId(provider)];
  if (!remembered?.model) return { model: null, modelOptions: [] };
  return {
    model: remembered.model,
    modelOptions: normalizeModelOptions(remembered.options),
  };
}

/**
 * Scheduled tasks: agent runs the user sets up once and Cozea repeats on a
 * clock. Lives under Agent Builds because it is the same question as a build,
 * asked about time rather than about skills.
 */
export function ScheduledTasksView() {
  const { data: snapshot, error: loadError } = useScheduledTasksSnapshot();
  /**
   * Provider models come from the local agent runtime's server config, which
   * the workbench connects for itself. This page lives outside any project, so
   * it opens that connection too; without it the model picker would only ever
   * know the one model this provider was last used with.
   */
  const substrate = useSubstrateChatTransport();
  useT3ServerConfigCutover({
    substrateActive: substrate.active,
    shadowBaseUrl: substrate.shadowBaseUrl,
  });
  const catalog = useWorkspaceCatalogSnapshot();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = React.useState<ScheduledTaskDraft | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const tasks = snapshot?.tasks ?? [];
  const computerUseEnabled = snapshot?.computerUseEnabled ?? false;
  const { principalId } = useAuth();
  const accessibleProjects = useQuery(
    api.projects.listSummariesForCurrentUser,
    principalId ? { userId: principalId } : "skip",
  );
  const availableProjects = React.useMemo(
    () => projectTargets(accessibleProjects, catalog?.entries ?? {}),
    [accessibleProjects, catalog],
  );
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<ScheduledTaskFilter>("all");
  const openTask = React.useMemo(
    () => tasks.find((task) => task.id === openTaskId) ?? null,
    [openTaskId, tasks],
  );
  const visibleTasks = React.useMemo(
    () => tasks.filter((task) => matchesFilter(task, filter) && matchesTaskSearch(task, query)),
    [filter, query, tasks],
  );

  const runMutation = React.useCallback(
    async (key: string, operation: () => Promise<{ success: boolean; error?: string }>, success: string | null) => {
      setBusyKey(key);
      try {
        const result = await operation();
        await scheduledTasksSnapshot.refresh().catch(() => undefined);
        if (!result.success) {
          setFormError(result.error ?? "That did not work.");
          if (result.error) appToast.error({ title: "Scheduled tasks", description: result.error });
          return result;
        }
        setFormError(null);
        if (success) appToast.success({ title: success });
        return result;
      } catch (error) {
        const description = error instanceof Error ? error.message : String(error);
        setFormError(description);
        appToast.error({ title: "Scheduled tasks", description });
        return { success: false, error: description };
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  const confirmDelete = React.useCallback(
    async (task: ScheduledTask) => {
      const answer = await window.electronAPI.dialog.showMessageBox({
        type: "warning",
        title: "Delete scheduled task",
        message: `Delete \u201c${task.name}\u201d?`,
        detail: "The schedule is removed. Nothing else about the provider or your skills changes.",
        buttons: ["Delete", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (answer.response !== 0) return;
      await runMutation(
        `task:${task.id}`,
        () => window.electronAPI.scheduledTasks.remove({ taskId: task.id }),
        `${task.name} deleted`,
      );
    },
    [runMutation],
  );

  /**
   * An agent tile can hand over a filled-in draft. It is consumed once and the
   * parameter is dropped, so closing the form does not reopen it.
   */
  const prefill = searchParams.get("draft");
  React.useEffect(() => {
    if (!prefill) return;
    const handed = draftFromPrefill(prefill, availableProjects);
    if (handed) {
      setFormError(null);
      setDraft(handed);
    }
    const next = new URLSearchParams(searchParams);
    next.delete("draft");
    setSearchParams(next, { replace: true });
  }, [availableProjects, prefill, searchParams, setSearchParams]);

  // The header only cares whether a form is open and whether it is an edit,
  // not what has been typed into it, so it is not rebuilt on every keystroke.
  const isEditing = draft !== null;
  const isEditingExisting = Boolean(draft?.taskId);
  const isViewingTask = !isEditing && openTask !== null;

  // Scheduled Tasks is its own place in the sidebar, so the only way back worth
  // offering is out of the form.
  const markRunOpened = React.useCallback(
    (runId: string) => {
      if (!openTaskId) return;
      void window.electronAPI.scheduledTasks
        .markRunSeen({ taskId: openTaskId, runId })
        .then(() => scheduledTasksSnapshot.refresh())
        .catch(() => undefined);
    },
    [openTaskId],
  );

  const headerLeft = React.useMemo(
    () =>
      isEditing || isViewingTask ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => (isEditing ? setDraft(null) : setOpenTaskId(null))}
        >
          <HugeiconsIcon icon={__ArrowLeftHugeIcon} className="size-3.5" />
          Back
        </Button>
      ) : null,
    [isEditing, isViewingTask],
  );

  const headerCenter = React.useMemo(
    () => (
      <span className="max-w-[40ch] truncate text-sm font-semibold tracking-tight text-foreground">
        {isEditing
          ? isEditingExisting
            ? "Edit scheduled task"
            : "New scheduled task"
          : (openTask?.name ?? "Scheduled tasks")}
      </span>
    ),
    [isEditing, isEditingExisting, openTask?.name],
  );

  const headerRight = React.useMemo(() => {
    if (isEditing) return null;
    if (openTask) {
      return (
        <div className="flex items-center gap-1">
          {/* Pausing is the reversible one, so it leads; delete stays last. */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busyKey === `task:${openTask.id}`}
            aria-label={openTask.enabled ? `Pause ${openTask.name}` : `Resume ${openTask.name}`}
            title={openTask.enabled ? "Pause" : "Resume"}
            onClick={() => {
              void runMutation(
                `task:${openTask.id}`,
                () =>
                  window.electronAPI.scheduledTasks.setEnabled({
                    taskId: openTask.id,
                    enabled: !openTask.enabled,
                  }),
                openTask.enabled ? `${openTask.name} paused` : `${openTask.name} resumed`,
              );
            }}
          >
            <HugeiconsIcon
              icon={openTask.enabled ? __PauseHugeIcon : __PlayHugeIcon}
              className="size-3.5"
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${openTask.name}`}
            onClick={() => {
              setFormError(null);
              setDraft(draftFromTask(openTask));
            }}
          >
            <HugeiconsIcon icon={__EditHugeIcon} className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${openTask.name}`}
            onClick={() => {
              void confirmDelete(openTask).then(() => setOpenTaskId(null));
            }}
          >
            <HugeiconsIcon icon={__DeleteHugeIcon} className="size-3.5" />
          </Button>
        </div>
      );
    }
    return (
      <Button
        type="button"
        size="sm"
        className="h-7 gap-1 rounded-full text-xs"
        onClick={() => {
          setFormError(null);
          setDraft(emptyDraft());
        }}
      >
        <HugeiconsIcon icon={__AddHugeIcon} className="size-3.5" aria-hidden />
        New task
      </Button>
    );
  }, [busyKey, confirmDelete, isEditing, openTask, runMutation]);

  useProjectHeader(headerLeft, headerCenter, { rightAddon: headerRight, hideShare: true });

  // An open task takes the whole surface: its two panes scroll on their own,
  // which a page-level scroll container would swallow.
  if (openTask && !draft) {
    return (
      <ScheduledTaskDetail
        task={openTask}
        summary={describeSchedule(openTask)}
        selectedRunId={selectedRunId}
        onSelectRun={setSelectedRunId}
        onRunOpened={markRunOpened}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[820px] px-6 pb-16 pt-10 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Scheduled tasks</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask an agent to schedule tasks, set reminders, or monitor for updates
        </p>

        {loadError && !snapshot ? (
          <p className="mt-8 text-sm text-destructive">{loadError}</p>
        ) : !snapshot ? (
          <p role="status" className="mt-8 text-sm text-muted-foreground">
            Reading your scheduled tasks…
          </p>
        ) : draft ? (
          <div className="mt-8">
            <ScheduledTaskEditor
              draft={draft}
              busy={busyKey === "save"}
              error={formError}
              computerUseEnabled={computerUseEnabled}
              projectTargets={availableProjects}
              onChange={setDraft}
              onCancel={() => {
                setFormError(null);
                setDraft(null);
              }}
              onSave={() => {
                void runMutation(
                  "save",
                  () => window.electronAPI.scheduledTasks.save(draft),
                  draft.taskId ? "Scheduled task saved" : "Scheduled task created",
                ).then((result) => {
                  if (result.success) setDraft(null);
                });
              }}
            />
          </div>
        ) : (
          <>
            <div className="relative mt-6">
              <HugeiconsIcon
                icon={__SearchHugeIcon}
                className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search scheduled tasks"
                aria-label="Search scheduled tasks"
                className="h-11 rounded-full bg-muted/50 pl-11 text-sm"
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-1">
              {SCHEDULED_TASK_FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={filter === option.id}
                  onClick={() => setFilter(option.id)}
                  className={cn(
                    "cursor-pointer rounded-full px-3 py-1 text-sm transition-colors",
                    filter === option.id
                      ? "border border-primary/60 text-foreground"
                      : "border border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {visibleTasks.length === 0 ? (
              <p className="mt-8 text-sm text-muted-foreground">
                {tasks.length === 0
                  ? "No scheduled tasks yet. Ask an agent to schedule one, or start from a suggestion below."
                  : "Nothing matches that."}
              </p>
            ) : (
              <ul className="mt-4">
                {visibleTasks.map((task) => (
                  <li key={task.id}>
                    <ScheduledTaskRow
                      task={task}
                      computerUseEnabled={computerUseEnabled}
                      busy={busyKey === `task:${task.id}`}
                      onOpen={() => {
                        setSelectedRunId(null);
                        setOpenTaskId(task.id);
                      }}
                      onEdit={() => {
                        setFormError(null);
                        setDraft(draftFromTask(task));
                      }}
                      onToggle={(enabled) => {
                        void runMutation(
                          `task:${task.id}`,
                          () =>
                            window.electronAPI.scheduledTasks.setEnabled({
                              taskId: task.id,
                              enabled,
                            }),
                          null,
                        );
                      }}
                      onDelete={() => {
                        void confirmDelete(task);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-8 border-t border-border/60 pt-6">
              <h2 className="text-base font-medium text-foreground">Suggestions</h2>
              <ul className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {SCHEDULED_TASK_SUGGESTIONS.map((suggestion) => (
                  <li key={suggestion.id}>
                    <SuggestionRow
                      suggestion={suggestion}
                      onUse={() => {
                        setFormError(null);
                        setDraft(draftFromSuggestion(suggestion));
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A suggestion becomes an ordinary draft: the form is still the thing that saves. */
export function draftFromSuggestion(
  suggestion: ScheduledTaskSuggestion,
  now: number = Date.now(),
): ScheduledTaskDraft {
  const start = new Date(now);
  start.setHours(suggestion.hour, 0, 0, 0);
  if (suggestion.weekday !== undefined) {
    // Land on the named day; a weekly recurrence then keeps that day forever.
    const shift = (suggestion.weekday - start.getDay() + 7) % 7;
    start.setDate(start.getDate() + shift);
  }
  // Today's slot has usually passed by the time someone reads the list.
  if (start.getTime() <= now) {
    start.setDate(start.getDate() + (suggestion.weekday === undefined ? 1 : 7));
  }
  return {
    ...emptyDraft(),
    name: suggestion.name,
    prompt: suggestion.prompt,
    startAt: start.getTime(),
    recurrence: suggestion.recurrence,
    project: null,
  };
}

function SuggestionRow({
  suggestion,
  onUse,
}: {
  suggestion: ScheduledTaskSuggestion;
  onUse: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onUse}
      className="group flex w-full cursor-pointer items-start gap-3 rounded-xl p-2 text-left transition-colors hover:bg-muted/40"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/60 transition-colors group-hover:bg-muted">
        <HugeiconsIcon icon={suggestion.icon} className="size-4 text-foreground/80" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{suggestion.name}</span>
        <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
          {suggestion.description}
        </span>
        <span className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground/70">
          <HugeiconsIcon icon={__ClockHugeIcon} className="size-3.5" aria-hidden />
          {suggestion.cadence}
        </span>
      </span>
    </button>
  );
}

/** The tag the user asked for: a computer-use run is not an ordinary one. */
export function ComputerUseTag({ available }: { available: boolean }) {
  const tag = (
    <Badge
      variant="outline"
      size="sm"
      className={cn(
        "gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-500",
        !available && "opacity-70",
      )}
    >
      <HugeiconsIcon icon={__ComputerHugeIcon} className="size-3" aria-hidden />
      Computer use
    </Badge>
  );
  if (available) return tag;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{tag}</span>
      </TooltipTrigger>
      <TooltipContent>
        Computer use is switched off in Settings, so this task cannot drive the desktop.
      </TooltipContent>
    </Tooltip>
  );
}

/** Which working directory a run lands in, project or not. */
function ProjectTag({ project }: { project: ScheduledTaskProjectTarget | null }) {
  if (!project) {
    return (
      <Badge variant="outline" size="sm" className="gap-1">
        General task
      </Badge>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Badge variant="outline" size="sm" className="gap-1">
            <HugeiconsIcon icon={__ProjectHugeIcon} className="size-3" aria-hidden />
            {project.label}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>{project.workspaceRoot}</TooltipContent>
    </Tooltip>
  );
}

function ProviderTag({ provider }: { provider: ScheduledTaskProvider }) {
  const Mark = PROVIDER_ICONS[provider];
  return (
    <Badge variant="secondary" size="sm" className="gap-1">
      <Mark aria-hidden className="size-3" />
      {PROVIDER_LABELS[provider]}
    </Badge>
  );
}

function ScheduledTaskRow({
  task,
  computerUseEnabled,
  busy,
  onOpen,
  onEdit,
  onToggle,
  onDelete,
}: {
  task: ScheduledTask;
  computerUseEnabled: boolean;
  busy: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const nextRunAt = computeNextRunAt(task);
  const overdue = task.enabled && nextRunAt !== null && nextRunAt < Date.now();
  return (
    <div className="group flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/40">
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggle(!task.enabled)}
        aria-label={task.enabled ? `Pause ${task.name}` : `Resume ${task.name}`}
        title={task.enabled ? "Pause" : "Resume"}
        className={cn(
          "mt-0.5 size-4 shrink-0 cursor-pointer rounded-full border transition-colors",
          task.enabled
            ? overdue
              ? "border-amber-500/70"
              : "border-muted-foreground/60 hover:border-foreground"
            : "border-muted-foreground/30 bg-muted-foreground/20",
        )}
      />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 cursor-pointer space-y-1 text-left"
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm text-foreground">{task.name}</span>
          <ProviderTag provider={task.provider} />
          <ProjectTag project={task.project} />
          {task.computerUse ? <ComputerUseTag available={computerUseEnabled} /> : null}
        </span>
        <span className="block text-sm text-muted-foreground">
          {describeCadence(task)} · {describeNextRun(task)}
        </span>
        {task.lastError ? (
          <span className="block text-xs text-destructive">
            Last run did not start: {task.lastError}
          </span>
        ) : null}
      </button>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onEdit}
          aria-label={`Edit ${task.name}`}
        >
          <HugeiconsIcon icon={__EditHugeIcon} className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={onDelete}
          aria-label={`Delete ${task.name}`}
        >
          <HugeiconsIcon icon={__DeleteHugeIcon} className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ScheduledTaskEditor({
  draft,
  busy,
  error,
  computerUseEnabled,
  projectTargets,
  onChange,
  onCancel,
  onSave,
}: {
  draft: ScheduledTaskDraft;
  busy: boolean;
  error: string | null;
  computerUseEnabled: boolean;
  projectTargets: ReadonlyArray<ScheduledTaskProjectTarget>;
  onChange: (next: ScheduledTaskDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [intervalText, setIntervalText] = React.useState(String(draft.recurrence.interval));
  const { config } = useAssistantRuntimeMetadata();
  const lastModelByInstanceId = useAssistantComposerDraftStore(
    (state) => state.lastModelSelectionByInstanceId,
  );
  const providerKind = SCHEDULED_TASK_PROVIDER_KINDS[draft.provider];
  const instanceId = scheduledTaskInstanceId(draft.provider);
  const serverModels = React.useMemo(
    () => getProviderModelOptions(config, providerKind, instanceId),
    [config, instanceId, providerKind],
  );
  // A saved task keeps its own model; a fresh one starts where this provider
  // was last left, and only then falls back to the provider's default.
  const selectedModel =
    normalizeModelSlug(draft.model, providerKind) ?? DEFAULT_MODEL_BY_PROVIDER[providerKind];
  const modelChoices = React.useMemo(
    () => modelChoicesFor(serverModels, selectedModel),
    [selectedModel, serverModels],
  );
  const optionDescriptors = React.useMemo(() => {
    const models = getProviderSnapshot(config, providerKind, instanceId)?.models ?? [];
    const capabilities = getProviderModelCapabilities(models, selectedModel, providerKind);
    return getModelSelectionOptionDescriptors(
      { instanceId, model: selectedModel, provider: providerKind, options: draft.modelOptions },
      capabilities,
    ).flatMap((descriptor) =>
      descriptor.type === "select" && isReasoningDescriptor(descriptor) ? [descriptor] : [],
    );
  }, [config, draft.modelOptions, instanceId, providerKind, selectedModel]);
  const { date, time } = splitLocalDateTime(draft.startAt);
  const repeat: RepeatChoice = draft.recurrence.unit ?? "once";
  const repeatChoice = REPEAT_CHOICES.find((choice) => choice.id === repeat) ?? REPEAT_CHOICES[0]!;
  const patch = (next: Partial<ScheduledTaskDraft>) => onChange({ ...draft, ...next });

  const setRecurrence = (next: ScheduledTaskRecurrence) => patch({ recurrence: next });
  const setStart = (nextDate: string, nextTime: string) => {
    const value = joinLocalDateTime(nextDate, nextTime);
    if (value !== null) patch({ startAt: value });
  };

  const preview = describeSchedule(
    {
      ...draft,
      id: draft.taskId ?? "preview",
      createdAt: 0,
      updatedAt: 0,
      lastRunAt: null,
      lastError: null,
      lastThreadId: null,
      runs: [],
      enabled: true,
    },
    Date.now(),
  );

  return (
    <form
      className="flex min-h-0 flex-col gap-5 overflow-y-auto rounded-2xl border border-border/60 bg-card/40 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="scheduled-task-name">Name</Label>
        <Input
          id="scheduled-task-name"
          value={draft.name}
          maxLength={120}
          placeholder="Nightly dependency sweep"
          onChange={(event) => patch({ name: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="scheduled-task-prompt">What should it do?</Label>
        <Textarea
          id="scheduled-task-prompt"
          value={draft.prompt}
          rows={4}
          maxLength={4000}
          placeholder="Check for outdated dependencies and open a summary of what changed."
          onChange={(event) => patch({ prompt: event.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Provider</Label>
        <div className="flex flex-wrap gap-2">
          {SCHEDULED_TASK_PROVIDERS.map((provider) => {
            const Mark = PROVIDER_ICONS[provider];
            const selected = draft.provider === provider;
            return (
              <Button
                key={provider}
                type="button"
                size="sm"
                variant={selected ? "default" : "outline"}
                className="gap-1.5"
                aria-pressed={selected}
                onClick={() =>
                  patch({ provider, ...resolveProviderModelDefault(provider, lastModelByInstanceId) })
                }
              >
                <Mark aria-hidden className="size-3.5" />
                {PROVIDER_LABELS[provider]}
              </Button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">The agent that runs this task.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div
          className={cn(
            "min-w-0 space-y-1.5",
            optionDescriptors.length === 0 && "sm:col-span-2",
          )}
        >
          <Label htmlFor="scheduled-task-model">Model</Label>
          <Select
            value={selectedModel}
            onValueChange={(value) => patch({ model: value, modelOptions: [] })}
          >
            <SelectTrigger id="scheduled-task-model" className="w-full">
              {/* Base UI cannot resolve a label while the popup is closed, so
                  the trigger renders it rather than showing the raw value. */}
              <SelectValue>
                {(value) =>
                  modelChoices.find((choice) => choice.slug === value)?.name ?? String(value ?? "")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent
              align="start"
              alignItemWithTrigger={false}
              className="min-w-[var(--anchor-width)]"
            >
              {modelChoices.map((choice) => (
                <SelectItem key={choice.slug} value={choice.slug}>
                  {choice.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {serverModels.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Showing your last used model. Start a chat with {PROVIDER_LABELS[draft.provider]} to
              load its full model list.
            </p>
          ) : null}
        </div>
        {optionDescriptors.map((descriptor) => (
          <div key={descriptor.id} className="min-w-0 space-y-1.5">
            <Label htmlFor={`scheduled-task-option-${descriptor.id}`}>{descriptor.label}</Label>
            <Select
              value={String(
                draft.modelOptions.find((option) => option.id === descriptor.id)?.value ??
                  descriptor.options.find((choice) => choice.isDefault)?.id ??
                  descriptor.options[0]?.id ??
                  "",
              )}
              onValueChange={(value) => {
                patch({
                  modelOptions: [
                    ...draft.modelOptions.filter((option) => option.id !== descriptor.id),
                    { id: descriptor.id, value },
                  ],
                });
              }}
            >
              <SelectTrigger id={`scheduled-task-option-${descriptor.id}`} className="w-full">
                <SelectValue>
                  {(value) =>
                    descriptor.options.find((choice) => choice.id === value)?.label ??
                    String(value ?? "")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent
                align="start"
                alignItemWithTrigger={false}
                className="min-w-[var(--anchor-width)]"
              >
                {descriptor.options.map((choice) => (
                  <SelectItem key={choice.id} value={choice.id}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="scheduled-task-project">Project</Label>
        <Select
          value={draft.project?.workspaceRoot ?? NO_PROJECT}
          onValueChange={(value) => {
            patch({
              project:
                value === NO_PROJECT
                  ? null
                  : projectTargets.find((target) => target.workspaceRoot === value) ?? null,
            });
          }}
        >
          <SelectTrigger id="scheduled-task-project" className="w-full">
            <SelectValue>
              {(value) =>
                value === NO_PROJECT || !value
                  ? NO_PROJECT_LABEL
                  : projectTargets.find((target) => target.workspaceRoot === value)?.label ??
                    basenameOf(String(value))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            align="start"
            alignItemWithTrigger={false}
            className="min-w-[var(--anchor-width)]"
          >
            <SelectItem value={NO_PROJECT}>{NO_PROJECT_LABEL}</SelectItem>
            {projectTargets.map((target) => (
              <SelectItem key={target.workspaceRoot} value={target.workspaceRoot}>
                {target.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {draft.project
            ? `Runs in ${draft.project.workspaceRoot}.`
            : "A general task. Runs in a scratch folder Cozea keeps, touching none of your projects."}
        </p>
      </div>

      {/* Driving the desktop is the one choice here with reach beyond the
          project, so the row carries the same amber the list's tag uses and
          says plainly which way it is set. */}
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl border p-3 transition-colors",
          draft.computerUse
            ? "border-amber-500/40 bg-amber-500/10"
            : "border-border/60 bg-background/40",
        )}
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
            draft.computerUse
              ? "bg-amber-500/20 text-amber-700 dark:text-amber-500"
              : "bg-muted/60 text-muted-foreground",
          )}
        >
          <HugeiconsIcon icon={__ComputerHugeIcon} className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Label htmlFor="scheduled-task-computer-use" className="text-sm">
              Computer use task
            </Label>
            <span
              className={cn(
                "text-xs font-medium",
                draft.computerUse
                  ? "text-amber-700 dark:text-amber-500"
                  : "text-muted-foreground",
              )}
            >
              {draft.computerUse ? "On" : "Off"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Lets the run drive your desktop through Open Computer Use, not just the project files.
            Tasks like this carry a Computer use tag in the list.
          </p>
          {draft.computerUse && !computerUseEnabled ? (
            <p className="text-xs text-amber-700 dark:text-amber-500">
              Computer use is switched off in Settings. Turn it on there before this task can
              drive the desktop.
            </p>
          ) : null}
        </div>
        <Switch
          id="scheduled-task-computer-use"
          checked={draft.computerUse}
          onCheckedChange={(checked) => patch({ computerUse: checked })}
          // The shared switch's unchecked track is near-invisible on this
          // panel; only this instance is strengthened.
          className="mt-0.5 shrink-0 data-[state=unchecked]:bg-muted-foreground/30 data-[state=checked]:bg-amber-500"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="scheduled-task-date">First run</Label>
          <Input
            id="scheduled-task-date"
            type="date"
            value={date}
            onChange={(event) => setStart(event.target.value, time)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scheduled-task-time">Time</Label>
          <Input
            id="scheduled-task-time"
            type="time"
            value={time}
            onChange={(event) => setStart(date, event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="scheduled-task-repeat">Repeats</Label>
          <Select
            value={repeat}
            onValueChange={(value) => {
              const unit = value as RepeatChoice;
              setRecurrence(
                unit === "once"
                  ? RUN_ONCE
                  : { unit, interval: Math.max(1, draft.recurrence.interval) },
              );
            }}
          >
            <SelectTrigger id="scheduled-task-repeat" className="w-full">
              <SelectValue>
                {(value) =>
                  REPEAT_CHOICES.find((choice) => choice.id === value)?.label ?? String(value ?? "")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent
              align="start"
              alignItemWithTrigger={false}
              className="min-w-[var(--anchor-width)]"
            >
              {REPEAT_CHOICES.map((choice) => (
                <SelectItem key={choice.id} value={choice.id}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {repeat === "once" ? null : (
          <div className="space-y-1.5">
            <Label htmlFor="scheduled-task-interval">Every</Label>
            <div className="flex items-center gap-2">
              <Input
                id="scheduled-task-interval"
                type="number"
                min={1}
                max={999}
                className="w-24"
                // Held as text so the field can be empty mid-edit; the draft
                // only takes a number it can actually schedule on.
                value={intervalText}
                onChange={(event) => {
                  setIntervalText(event.target.value);
                  const parsed = Number.parseInt(event.target.value, 10);
                  if (Number.isFinite(parsed) && parsed > 0) {
                    setRecurrence({ unit: draft.recurrence.unit, interval: Math.min(parsed, 999) });
                  }
                }}
                onBlur={() => setIntervalText(String(draft.recurrence.interval))}
              />
              <span className="text-sm text-muted-foreground">{repeatChoice.unitNoun}</span>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground" role="status">
        {preview}
      </p>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving…" : draft.taskId ? "Save task" : "Create task"}
        </Button>
      </div>
    </form>
  );
}

export default ScheduledTasksView;

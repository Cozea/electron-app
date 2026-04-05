"use client";

import * as React from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { ContextMenuItem } from "@cozea/assistant-contracts";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { useShallow } from "zustand/react/shallow";
import type {
  GitSyncStatusResult,
  ProjectLaneDescriptor,
  ProjectLaneState,
} from "@shared/electronApiTypes";
import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  Clock3,
  EllipsisVertical,
  FolderIcon,
  Loader2,
  MonitorCog,
  SquarePen,
  SlidersHorizontal,
  SquareTerminal,
  User,
  Users,
} from "lucide-react";

import { useViewTransitionNavigate } from "@/lib/navigation";
import { useLocation } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useScopedAppContext } from "@/hooks/useScopedAppContext";
import { useAccessibleProject } from "@/features/projects/hooks/useAccessibleProject";
import { useOptionalProjectSyncContext } from "@/features/projects/contexts/ProjectSyncContext";
import { useProjectLaneState } from "@/features/projects/hooks/useProjectLaneState";
import { useProjectCreationMenu } from "@/features/projects/hooks/useProjectCreationMenu";
import { useLocalProjectPath } from "@/features/projects/hooks/useLocalProjectPath";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { NavUser } from "@/components/nav-user";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { buildProjectPath } from "../lib/projectRoutes";
import { buildWorkbenchHref } from "../lib/lastWorkbenchRoute";
import {
  prepareGitProjectForOpen,
  type ProjectOpenGitProjectLike,
} from "../lib/projectOpenGitSync";
import { formatProjectCloudAccessError } from "../lib/projectCloudAccessPresentation";
import {
  formatProjectDeleteError,
  formatProjectRenameError,
} from "../lib/projectMutationPresentation";
import {
  type WorkbenchAssistantChatTile,
  type WorkbenchProjectState,
  type WorkbenchTile,
  buildWorkbenchScopeKey,
  selectProjectLaneWorkbenches,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore";
import { useStore } from "@/stores/assistant-store";
import { primeLocalProjectPath } from "@/features/projects/hooks/useLocalProjectPath";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
} from "@/features/projects/components/assistant/chat/session-logic";
import {
  ClaudeAI,
  Gemini,
  OpenAI,
  OpenCodeIcon,
} from "@/features/projects/components/assistant/Icons";
import { ProjectDeleteDialog } from "./ProjectDeleteDialog";
import { ProjectRenameDialog } from "./ProjectRenameDialog";

interface ProjectSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user?: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  } | null;
  onLogout?: () => void;
  projectId?: Id<"projects"> | null;
  presenceUsers?: unknown[];
  presenceCount?: number;
}

interface SidebarProjectItem extends ProjectOpenGitProjectLike {
  id: string;
  name: string;
  status: string;
  template?: string | null;
  slug: string;
  updatedAt: number;
  localPath: string | null;
  sourceControl: Doc<"projects">["sourceControl"];
  gitRepository: Doc<"projects">["gitRepository"];
}

interface SidebarProjectTreeItemProps {
  project: SidebarProjectItem;
  projectIndex: number;
  projectCount: number;
  isCurrentProject: boolean;
  isExpanded: boolean;
  expandedLaneIds: string[];
  activeSelectionLevel: "none" | "project" | "lane" | "tile";
  activeTileId: string | null;
  currentProjectPath: string | null;
  onToggleExpanded: (projectId: string) => void;
  onToggleLaneExpanded: (projectId: string, laneId: string) => void;
  onOpenProject: (project: SidebarProjectItem, localPath: string | null) => Promise<void>;
  onOpenProjectFolder: (project: SidebarProjectItem, localPath: string | null) => Promise<void>;
  onOpenProjectSettings: (project: SidebarProjectItem) => void;
  onRenameProject: (project: SidebarProjectItem) => void;
  onArchiveProject: (project: SidebarProjectItem) => Promise<void>;
  onRestoreProject: (project: SidebarProjectItem) => Promise<void>;
  onDeleteProject: (project: SidebarProjectItem) => void;
  onSyncProject: (project: SidebarProjectItem) => Promise<void>;
  onMoveProject: (projectId: string, direction: "up" | "down") => void;
  isSyncingProject: boolean;
  onOpenLaneWorkbench: (
    project: SidebarProjectItem,
    laneId: string,
    options?: {
      openTile?: "assistantChat" | "browser" | "terminal" | "devServer";
      focusTileId?: string;
    },
  ) => Promise<void>;
  prefetchedLaneState?: ProjectLaneState | null;
  prefetchedActiveLane?: ProjectLaneDescriptor | null;
  onRefreshActiveLaneState?: () => Promise<void>;
}

const loadedProjectFaviconSrcs = new Set<string>();
const PROJECT_SIDEBAR_STATE_STORAGE_KEY = "cozea.projectSidebar.state.v1";
const PROJECT_FAVICON_HTTP_ORIGIN = resolveWsHttpOrigin();

interface PersistedProjectSidebarState {
  expandedProjectIds: string[];
  expandedLaneIdsByProjectId: Record<string, string[]>;
  projectOrderIds: string[];
}

function resolveWsHttpOrigin(): string {
  if (typeof window === "undefined") return "";
  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsCandidate =
    typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0
      ? bridgeWsUrl
      : typeof envWsUrl === "string" && envWsUrl.length > 0
        ? envWsUrl
        : null;
  if (!wsCandidate) return window.location.origin;
  try {
    const wsUrl = new URL(wsCandidate);
    const protocol =
      wsUrl.protocol === "wss:" ? "https:" : wsUrl.protocol === "ws:" ? "http:" : wsUrl.protocol;
    return `${protocol}//${wsUrl.host}`;
  } catch {
    return window.location.origin;
  }
}

function ProjectFavicon(props: { cwd: string | null; className?: string }) {
  const iconClassName = props.className ?? "size-3.5";
  const imageClassName = props.className ?? "h-3.5 w-auto max-w-8";
  const src = React.useMemo(() => {
    if (!props.cwd) return null;
    return `${PROJECT_FAVICON_HTTP_ORIGIN}/api/project-favicon?cwd=${encodeURIComponent(props.cwd)}`;
  }, [props.cwd]);
  const [status, setStatus] = React.useState<"loading" | "loaded" | "error">(() =>
    src && loadedProjectFaviconSrcs.has(src) ? "loaded" : "loading",
  );

  React.useEffect(() => {
    if (!src) {
      setStatus("error");
      return;
    }
    setStatus(loadedProjectFaviconSrcs.has(src) ? "loaded" : "loading");
  }, [src]);

  if (!src || status === "error") {
    return <FolderIcon className={cn(iconClassName, "shrink-0 text-muted-foreground/55")} />;
  }

  return (
    <img
      src={src}
      alt=""
      className={cn(imageClassName, "shrink-0 object-contain", status === "loading" && "hidden")}
      onLoad={() => {
        loadedProjectFaviconSrcs.add(src);
        setStatus("loaded");
      }}
      onError={() => setStatus("error")}
    />
  );
}

function sortProjectsAlphabetically(projects: SidebarProjectItem[]): SidebarProjectItem[] {
  return [...projects].sort(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id, undefined, { sensitivity: "base" }),
  );
}

function dedupeStringArray(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function normalizeExpandedLaneIdsByProjectId(
  value: PersistedProjectSidebarState["expandedLaneIdsByProjectId"] | null | undefined,
): Record<string, string[]> {
  if (!value) return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(
        ([projectId, laneIds]) =>
          [projectId, dedupeStringArray(Array.isArray(laneIds) ? laneIds : [])] as const,
      )
      .filter(([, laneIds]) => laneIds.length > 0),
  );
}

function readPersistedProjectSidebarState(): PersistedProjectSidebarState {
  if (typeof window === "undefined") {
    return {
      expandedProjectIds: [],
      expandedLaneIdsByProjectId: {},
      projectOrderIds: [],
    };
  }

  try {
    const raw = window.localStorage.getItem(PROJECT_SIDEBAR_STATE_STORAGE_KEY);
    if (!raw) {
      return {
        expandedProjectIds: [],
        expandedLaneIdsByProjectId: {},
        projectOrderIds: [],
      };
    }

    const parsed = JSON.parse(raw) as Partial<PersistedProjectSidebarState>;
    return {
      expandedProjectIds: dedupeStringArray(
        Array.isArray(parsed.expandedProjectIds) ? parsed.expandedProjectIds : [],
      ),
      expandedLaneIdsByProjectId: normalizeExpandedLaneIdsByProjectId(
        parsed.expandedLaneIdsByProjectId,
      ),
      projectOrderIds: dedupeStringArray(
        Array.isArray(parsed.projectOrderIds) ? parsed.projectOrderIds : [],
      ),
    };
  } catch {
    return {
      expandedProjectIds: [],
      expandedLaneIdsByProjectId: {},
      projectOrderIds: [],
    };
  }
}

function buildOrderedProjects(
  projects: SidebarProjectItem[],
  projectOrderIds: readonly string[],
): SidebarProjectItem[] {
  const projectsById = new Map(projects.map((project) => [project.id, project] as const));
  const orderedProjects: SidebarProjectItem[] = [];

  for (const projectId of projectOrderIds) {
    const project = projectsById.get(projectId);
    if (!project) continue;
    orderedProjects.push(project);
    projectsById.delete(projectId);
  }

  return [...orderedProjects, ...sortProjectsAlphabetically([...projectsById.values()])];
}

function areSidebarProjectItemsEqual(left: SidebarProjectItem, right: SidebarProjectItem): boolean {
  return (
    left.id === right.id &&
    left._id === right._id &&
    left.name === right.name &&
    left.status === right.status &&
    left.template === right.template &&
    left.slug === right.slug &&
    left.updatedAt === right.updatedAt &&
    left.organizationId === right.organizationId &&
    left.createdBy === right.createdBy &&
    left.syncMode === right.syncMode &&
    left.localPath === right.localPath &&
    left.sourceControl === right.sourceControl &&
    left.gitRepository === right.gitRepository
  );
}

function areStringListsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function showNativeSidebarMenu<T extends string>(
  event: React.MouseEvent<HTMLElement>,
  items: readonly ContextMenuItem<T>[],
): Promise<T | null> {
  event.preventDefault();
  event.stopPropagation();

  if (items.length === 0) {
    return null;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const position = {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.bottom),
  };

  if (window.desktopBridge?.showContextMenu) {
    return window.desktopBridge.showContextMenu(items, position);
  }

  if (window.nativeApi?.contextMenu?.show) {
    return window.nativeApi.contextMenu.show(items, position);
  }

  return null;
}

function resolveProjectCollabBranch(project: SidebarProjectItem): string {
  return (
    project.sourceControl?.activeCollabBranch ??
    project.sourceControl?.defaultBranch ??
    project.gitRepository?.defaultBranch ??
    "main"
  );
}

function getLaneStatusBadges(status: GitSyncStatusResult | null): string[] {
  if (!status?.success || !status.isRepo) {
    return [];
  }

  const badges: string[] = [];

  if ((status.behind ?? 0) > 0) {
    badges.push(`↓${status.behind}`);
  }
  if ((status.ahead ?? 0) > 0) {
    badges.push(`↑${status.ahead}`);
  }
  if (status.hasConflicts) {
    badges.push("Conflicts");
  }
  if (
    status.clean === false ||
    status.hasStagedChanges ||
    status.hasUnstagedChanges ||
    status.hasUntrackedChanges
  ) {
    badges.push("Dirty");
  }

  return badges;
}

function formatRelativeAge(createdAt: number, now: number): string {
  const diffMs = Math.max(0, now - createdAt);
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

function getTileCollections(workbench: WorkbenchProjectState | null | undefined): {
  agents: WorkbenchAssistantChatTile[];
  surfaces: WorkbenchTile[];
} {
  if (!workbench) {
    return { agents: [], surfaces: [] };
  }

  const orderedTiles = workbench.order
    .map((tileId) => workbench.tiles[tileId])
    .filter((tile): tile is WorkbenchTile => Boolean(tile))
    .filter((tile) => tile.type !== "selection");

  return {
    agents: orderedTiles.filter(
      (tile): tile is WorkbenchAssistantChatTile => tile.type === "assistantChat",
    ),
    surfaces: orderedTiles.filter(
      (tile) => tile.type === "browser" || tile.type === "devServer" || tile.type === "terminal",
    ),
  };
}

function useLaneGitStatus(projectPath: string | null, enabled: boolean) {
  const [status, setStatus] = React.useState<GitSyncStatusResult | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    if (!enabled || !projectPath) {
      setStatus(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void window.electronAPI.sync
      .gitStatus({ projectPath })
      .then((result) => {
        if (cancelled) return;
        setStatus(result);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus(null);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, projectPath]);

  return { status, isLoading };
}

function ProviderGlyph(props: { provider?: string | null; className?: string }) {
  const className = props.className ?? "size-3.5";

  switch (props.provider) {
    case "claudeAgent":
      return <ClaudeAI className={className} />;
    case "gemini":
      return <Gemini className={className} />;
    case "openCode":
      return <OpenCodeIcon className={className} />;
    case "codex":
    default:
      return <OpenAI className={className} />;
  }
}

interface SidebarAgentStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

function hasUnseenCompletion(
  thread: NonNullable<ReturnType<typeof useStore.getState>["threads"][number]>,
): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

function resolveAgentStatusPill(input: {
  thread: NonNullable<ReturnType<typeof useStore.getState>["threads"][number]>;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
}): SidebarAgentStatusPill | null {
  const { hasPendingApprovals, hasPendingUserInput, thread } = input;

  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    hasActionableProposedPlan(
      findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null),
    );

  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

function AgentStatusPill(props: { threadId?: string | null }) {
  const thread = useStore((state) =>
    props.threadId ? (state.threads.find((entry) => entry.id === props.threadId) ?? null) : null,
  );

  if (!thread) return null;

  const pendingApprovals = derivePendingApprovals(thread.activities ?? []);
  const pendingUserInputs = derivePendingUserInputs(thread.activities ?? []);
  const statusPill = resolveAgentStatusPill({
    thread,
    hasPendingApprovals: pendingApprovals.length > 0,
    hasPendingUserInput: pendingUserInputs.length > 0,
  });

  if (!statusPill) return null;

  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px]", statusPill.colorClass)}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          statusPill.dotClass,
          statusPill.pulse && "animate-pulse",
        )}
      />
      <span className="hidden md:inline">{statusPill.label}</span>
    </span>
  );
}

const SidebarProjectTreeItem = React.memo(
  function SidebarProjectTreeItem({
    project,
    projectIndex,
    projectCount,
    isCurrentProject,
    isExpanded,
    expandedLaneIds,
    activeSelectionLevel,
    activeTileId,
    currentProjectPath,
    onToggleExpanded,
    onToggleLaneExpanded,
    onOpenProject,
    onOpenProjectFolder,
    onOpenProjectSettings,
    onRenameProject,
    onArchiveProject,
    onRestoreProject,
    onDeleteProject,
    onSyncProject,
    onMoveProject,
    isSyncingProject,
    onOpenLaneWorkbench,
    prefetchedLaneState,
    prefetchedActiveLane,
    onRefreshActiveLaneState,
  }: SidebarProjectTreeItemProps) {
    const shouldLoadLanes = isExpanded || isCurrentProject;
    const collabBranch = React.useMemo(() => resolveProjectCollabBranch(project), [project]);
    const { localPath } = useLocalProjectPath({
      initialPath: isCurrentProject ? (currentProjectPath ?? project.localPath) : project.localPath,
      preferInitialPath: isCurrentProject && Boolean(currentProjectPath),
      lookupOnMount: shouldLoadLanes,
      projectId: project.id,
      projectSlug: project.slug,
    });
    const projectIconPath = React.useMemo(
      () => project.localPath ?? localPath,
      [localPath, project.localPath],
    );
    const fetchedLaneState = useProjectLaneState({
      projectId: prefetchedLaneState ? null : shouldLoadLanes ? project.id : null,
      projectPath: prefetchedLaneState ? null : shouldLoadLanes ? localPath : null,
      collabBranch,
    });
    const laneState = prefetchedLaneState ?? fetchedLaneState.laneState;
    const activeLane = prefetchedActiveLane ?? fetchedLaneState.activeLane;
    const laneWorkbenches = useProjectWorkbenchStore(
      useShallow(selectProjectLaneWorkbenches(project.id)),
    );
    const handleProjectMenuClick = React.useCallback(
      async (event: React.MouseEvent<HTMLButtonElement>) => {
        const items: ContextMenuItem<
          | "open-project"
          | "open-folder"
          | "settings"
          | "rename"
          | "archive"
          | "restore"
          | "delete"
          | "move-up"
          | "move-down"
          | "sync"
          | "divider-primary"
          | "divider-secondary"
        >[] = [
          { id: "open-project", label: "Open Project" },
          { id: "open-folder", label: "Open Folder" },
          { id: "settings", label: "Settings" },
          { id: "divider-primary", label: "", type: "separator" },
          { id: "rename", label: "Rename" },
          {
            id: project.status === "archived" ? "restore" : "archive",
            label: project.status === "archived" ? "Restore" : "Archive",
          },
          { id: "delete", label: "Delete" },
        ];

        const hasSidebarActions =
          projectIndex > 0 ||
          projectIndex < projectCount - 1 ||
          (isCurrentProject && currentProjectPath && !isSyncingProject);

        if (hasSidebarActions) {
          items.push({ id: "divider-secondary", label: "", type: "separator" });
        }

        if (projectIndex > 0) {
          items.push({ id: "move-up", label: "Move up" });
        }

        if (projectIndex < projectCount - 1) {
          items.push({ id: "move-down", label: "Move down" });
        }

        if (isCurrentProject && currentProjectPath && !isSyncingProject) {
          items.push({ id: "sync", label: "Sync" });
        }

        const action = await showNativeSidebarMenu(event, items);
        if (!action) return;

        switch (action) {
          case "open-project":
            void onOpenProject(project, localPath ?? project.localPath);
            break;
          case "open-folder":
            void onOpenProjectFolder(project, localPath ?? project.localPath);
            break;
          case "settings":
            onOpenProjectSettings(project);
            break;
          case "rename":
            onRenameProject(project);
            break;
          case "archive":
            void onArchiveProject(project);
            break;
          case "restore":
            void onRestoreProject(project);
            break;
          case "delete":
            onDeleteProject(project);
            break;
          case "move-up":
            onMoveProject(project.id, "up");
            break;
          case "move-down":
            onMoveProject(project.id, "down");
            break;
          case "sync":
            void onSyncProject(project);
            break;
        }
      },
      [
        currentProjectPath,
        isCurrentProject,
        isSyncingProject,
        localPath,
        onArchiveProject,
        onDeleteProject,
        onMoveProject,
        onOpenProject,
        onOpenProjectFolder,
        onOpenProjectSettings,
        onRenameProject,
        onRestoreProject,
        onSyncProject,
        project,
        project.id,
        projectCount,
        projectIndex,
      ],
    );

    return (
      <Collapsible open={isExpanded}>
        <div className="group/project-item flex items-center gap-1">
          <button
            type="button"
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]",
              activeSelectionLevel === "project" && "bg-[var(--sidebar-pill-active-bg)] text-[var(--sidebar-pill-active-fg)]",
            )}
            onClick={() => onToggleExpanded(project.id)}
          >
            <ProjectFavicon cwd={projectIconPath} />
            <div className="min-w-0 flex flex-1 items-center gap-1.5 overflow-hidden">
              <span className="min-w-0 truncate text-xs font-normal">{project.name}</span>
              <ChevronRight
                className={cn(
                  "size-4 shrink-0 text-muted-foreground/75 transition-transform",
                  isExpanded && "rotate-90",
                )}
              />
            </div>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 rounded-md p-0 text-muted-foreground/70 opacity-0 transition-opacity group-hover/project-item:opacity-100 group-focus-within/project-item:opacity-100 hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]"
            onClick={handleProjectMenuClick}
            aria-label={`${project.name} options`}
          >
            <EllipsisVertical className="size-3.5" />
          </Button>
        </div>

        <CollapsibleContent className="overflow-hidden">
          <div className="ml-4 mt-0.5 space-y-1 border-l border-border/60 pl-3">
            {!shouldLoadLanes ? null : laneState === null ? (
              <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Loading lanes…
              </div>
            ) : laneState.lanes.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-muted-foreground">No lanes yet</div>
            ) : (
              laneState.lanes.map((lane) => (
                <SidebarLaneRow
                  key={lane.id}
                  lane={lane}
                  workbench={laneWorkbenches[lane.id] ?? null}
                  isCurrentLane={lane.id === activeLane?.id}
                  isExpanded={expandedLaneIds.includes(lane.id)}
                  isVisuallyActive={lane.id === activeLane?.id && activeSelectionLevel === "lane"}
                  activeTileId={
                    lane.id === activeLane?.id && activeSelectionLevel === "tile"
                      ? activeTileId
                      : null
                  }
                  onToggleExpanded={() => onToggleLaneExpanded(project.id, lane.id)}
                  onOpenLaneWorkbench={(options) => onOpenLaneWorkbench(project, lane.id, options)}
                  onRefreshLaneState={
                    lane.id === activeLane?.id && onRefreshActiveLaneState
                      ? onRefreshActiveLaneState
                      : undefined
                  }
                />
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  },
  (prev, next) => {
    return (
      areSidebarProjectItemsEqual(prev.project, next.project) &&
      prev.projectIndex === next.projectIndex &&
      prev.projectCount === next.projectCount &&
      prev.isCurrentProject === next.isCurrentProject &&
      prev.isExpanded === next.isExpanded &&
      areStringListsEqual(prev.expandedLaneIds, next.expandedLaneIds) &&
      prev.activeSelectionLevel === next.activeSelectionLevel &&
      prev.activeTileId === next.activeTileId &&
      prev.currentProjectPath === next.currentProjectPath &&
      prev.isSyncingProject === next.isSyncingProject &&
      prev.prefetchedLaneState === next.prefetchedLaneState &&
      prev.prefetchedActiveLane === next.prefetchedActiveLane &&
      prev.onToggleExpanded === next.onToggleExpanded &&
      prev.onToggleLaneExpanded === next.onToggleLaneExpanded &&
      prev.onOpenProject === next.onOpenProject &&
      prev.onOpenProjectFolder === next.onOpenProjectFolder &&
      prev.onOpenProjectSettings === next.onOpenProjectSettings &&
      prev.onRenameProject === next.onRenameProject &&
      prev.onArchiveProject === next.onArchiveProject &&
      prev.onRestoreProject === next.onRestoreProject &&
      prev.onDeleteProject === next.onDeleteProject &&
      prev.onSyncProject === next.onSyncProject &&
      prev.onMoveProject === next.onMoveProject &&
      prev.onOpenLaneWorkbench === next.onOpenLaneWorkbench &&
      prev.onRefreshActiveLaneState === next.onRefreshActiveLaneState
    );
  },
);

const SidebarLaneRow = React.memo(
  function SidebarLaneRow(props: {
    lane: ProjectLaneDescriptor;
    workbench: WorkbenchProjectState | null;
    isCurrentLane: boolean;
    isExpanded: boolean;
    isVisuallyActive: boolean;
    activeTileId: string | null;
    onToggleExpanded: () => void;
    onOpenLaneWorkbench: (options?: {
      openTile?: "assistantChat" | "browser" | "terminal" | "devServer";
      focusTileId?: string;
    }) => Promise<void>;
    onRefreshLaneState?: () => Promise<void>;
  }) {
    const [relativeNow, setRelativeNow] = React.useState(() => Date.now());
    const { agents, surfaces } = React.useMemo(
      () => getTileCollections(props.workbench),
      [props.workbench],
    );
    const { status, isLoading } = useLaneGitStatus(props.lane.projectPath, props.isCurrentLane);
    const statusBadges = React.useMemo(() => getLaneStatusBadges(status), [status]);
    const LaneScopeIcon = props.lane.isCollab ? Users : User;
    const laneScopeLabel = props.lane.isCollab ? "Collaboration lane" : "Personal lane";
    const handleLaneMenuClick = React.useCallback(
      async (event: React.MouseEvent<HTMLButtonElement>) => {
        if (!props.onRefreshLaneState) return;

        const action = await showNativeSidebarMenu(event, [
          { id: "refresh", label: "Refresh lane" },
        ] satisfies readonly ContextMenuItem<"refresh">[]);

        if (action === "refresh") {
          void props.onRefreshLaneState();
        }
      },
      [props.onRefreshLaneState],
    );

    React.useEffect(() => {
      const intervalId = window.setInterval(() => {
        setRelativeNow(Date.now());
      }, 60_000);

      return () => {
        window.clearInterval(intervalId);
      };
    }, []);

    return (
      <Collapsible open={props.isExpanded}>
        <div className="group/lane-row space-y-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]",
                props.isVisuallyActive && "bg-[var(--sidebar-pill-active-bg)] text-[var(--sidebar-pill-active-fg)]",
              )}
              aria-expanded={props.isExpanded}
              onClick={() => {
                props.onToggleExpanded();
                if (!props.isCurrentLane || !props.isVisuallyActive) {
                  void props.onOpenLaneWorkbench();
                }
              }}
            >
              <div className="min-w-0 flex flex-1 items-center gap-1.5 overflow-hidden">
                <span className="min-w-0 truncate text-xs text-muted-foreground/75">
                  {props.lane.branch}
                </span>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground/75 transition-transform",
                    !props.isExpanded && "-rotate-90",
                  )}
                />
                <span className="shrink-0 text-muted-foreground/35">·</span>
                <span
                  className="inline-flex shrink-0 items-center text-xs text-muted-foreground/70"
                  aria-label={laneScopeLabel}
                  title={laneScopeLabel}
                >
                  <LaneScopeIcon className="size-4" />
                </span>
                {isLoading ? (
                  <>
                    <span className="shrink-0 text-muted-foreground/35">·</span>
                    <span className="shrink-0 text-xs text-muted-foreground/70">Checking…</span>
                  </>
                ) : (
                  statusBadges.map((badge) => (
                    <React.Fragment key={badge}>
                      <span className="shrink-0 text-muted-foreground/35">·</span>
                      <span className="shrink-0 text-xs font-medium text-muted-foreground/60">
                        {badge}
                      </span>
                    </React.Fragment>
                  ))
                )}
              </div>
            </button>
            {props.onRefreshLaneState ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 rounded-md p-0 text-muted-foreground/70 opacity-0 transition-opacity group-hover/lane-row:opacity-100 group-focus-within/lane-row:opacity-100 hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]"
                onClick={handleLaneMenuClick}
                aria-label={`${props.lane.name} options`}
              >
                <EllipsisVertical className="size-3.5" />
              </Button>
            ) : null}
          </div>

          <CollapsibleContent className="overflow-hidden">
            <div className="space-y-2 pb-1">
              {agents.length > 0 ? (
                <div className="space-y-1">
                  <div className="px-2 text-[11px] font-medium text-muted-foreground/55">
                    Agents
                  </div>
                  {agents.map((tile) => (
                    <button
                      key={tile.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]",
                        props.activeTileId === tile.id && "bg-[var(--sidebar-pill-active-bg)] text-[var(--sidebar-pill-active-fg)]",
                      )}
                      onClick={() => {
                        void props.onOpenLaneWorkbench({ focusTileId: tile.id });
                      }}
                    >
                      <ProviderGlyph
                        provider={tile.provider}
                        className="size-4 shrink-0 text-muted-foreground/75"
                      />
                      <span className="min-w-0 flex-1 truncate text-xs">{tile.title}</span>
                      <AgentStatusPill threadId={tile.threadId} />
                      <span className="shrink-0 text-xs text-muted-foreground/65">
                        {formatRelativeAge(tile.createdAt, relativeNow)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {surfaces.length > 0 ? (
                <div className="space-y-1">
                  <div className="px-2 text-[11px] font-medium text-muted-foreground/55">
                    Surfaces
                  </div>
                  {surfaces.map((tile) => {
                    const Icon =
                      tile.type === "browser"
                        ? AppWindow
                        : tile.type === "devServer"
                          ? MonitorCog
                          : SquareTerminal;

                    return (
                      <button
                        key={tile.id}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]",
                          props.activeTileId === tile.id && "bg-[var(--sidebar-pill-active-bg)] text-[var(--sidebar-pill-active-fg)]",
                        )}
                        onClick={() => {
                          void props.onOpenLaneWorkbench({ focusTileId: tile.id });
                        }}
                      >
                        <Icon className="size-4 shrink-0 text-muted-foreground/75" />
                        <span className="min-w-0 flex-1 truncate text-xs">{tile.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground/65">
                          {formatRelativeAge(tile.createdAt, relativeNow)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {agents.length === 0 && surfaces.length === 0 ? (
                <div className="px-2 py-1 text-xs text-muted-foreground">
                  No workbench tiles in this lane yet
                </div>
              ) : null}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    );
  },
  (prev, next) => {
    return (
      prev.lane === next.lane &&
      prev.workbench === next.workbench &&
      prev.isCurrentLane === next.isCurrentLane &&
      prev.isExpanded === next.isExpanded &&
      prev.isVisuallyActive === next.isVisuallyActive &&
      prev.activeTileId === next.activeTileId &&
      prev.onToggleExpanded === next.onToggleExpanded &&
      prev.onOpenLaneWorkbench === next.onOpenLaneWorkbench &&
      prev.onRefreshLaneState === next.onRefreshLaneState
    );
  },
);

export function ProjectSidebar({
  user,
  onLogout,
  projectId: providedProjectId,
  presenceUsers: _presenceUsers,
  presenceCount: _presenceCount,
  className,
  ...props
}: ProjectSidebarProps) {
  const convex = useConvex();
  const navigate = useViewTransitionNavigate();
  const location = useLocation();
  const { openProjectCreationMenu } = useProjectCreationMenu();
  const { convexUserId } = useAuth();
  const { personalScoped, convexOrganizationId, workspaceScoped } = useScopedAppContext();
  const { project: currentProject, projectIdParam } = useAccessibleProject();
  const projectSyncContext = useOptionalProjectSyncContext();
  const currentProjectId = providedProjectId
    ? String(providedProjectId)
    : currentProject?._id
      ? String(currentProject._id)
      : projectIdParam;
  const currentProjectPath = projectSyncContext?.projectPath ?? null;
  const persistedSidebarState = React.useMemo(() => readPersistedProjectSidebarState(), []);
  const stableProjectItemsRef = React.useRef<Map<string, SidebarProjectItem>>(new Map());
  const [expandedProjectIds, setExpandedProjectIds] = React.useState<string[]>(
    () => persistedSidebarState.expandedProjectIds,
  );
  const [expandedLaneIdsByProjectId, setExpandedLaneIdsByProjectId] = React.useState<
    Record<string, string[]>
  >(() => persistedSidebarState.expandedLaneIdsByProjectId);
  const [projectOrderIds, setProjectOrderIds] = React.useState<string[]>(
    () => persistedSidebarState.projectOrderIds,
  );
  const [isSyncingProject, setIsSyncingProject] = React.useState(false);
  const [projectPendingRename, setProjectPendingRename] = React.useState<SidebarProjectItem | null>(
    null,
  );
  const [renameValue, setRenameValue] = React.useState("");
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [isRenamingProject, setIsRenamingProject] = React.useState(false);
  const [projectPendingDelete, setProjectPendingDelete] = React.useState<SidebarProjectItem | null>(
    null,
  );
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [isDeletingProject, setIsDeletingProject] = React.useState(false);
  const updateProject = useMutation(api.projects.update);
  const archiveProject = useMutation(api.projects.archive);
  const restoreProject = useMutation(api.projects.restore);
  const deleteProject = useMutation(api.projects.deleteProject);
  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath);

  const organizationProjects = useQuery(
    api.projects.listForOrganization,
    !personalScoped && convexOrganizationId && convexUserId
      ? {
          organizationId: convexOrganizationId,
          userId: convexUserId,
        }
      : "skip",
  );
  const personalProjects = useQuery(
    api.projects.listForPersonalWorkspaceMemberView,
    personalScoped && convexUserId
      ? {
          userId: convexUserId,
        }
      : "skip",
  );

  const projectItems = React.useMemo<SidebarProjectItem[]>(() => {
    const source = personalScoped ? personalProjects : organizationProjects;
    if (!source) {
      return [];
    }

    const nextStableProjectMap = new Map<string, SidebarProjectItem>();

    const nextItems = source
      .filter((project): project is NonNullable<typeof project> => Boolean(project))
      .map((project) => {
        const nextProjectItem: SidebarProjectItem = {
          _id: project._id,
          id: String(project._id),
          name: project.name,
          status: project.status,
          template: project.template ?? null,
          slug: project.slug,
          updatedAt: project.updatedAt,
          organizationId: project.organizationId,
          createdBy: project.createdBy ?? null,
          syncMode: project.syncMode,
          localPath: project.localPath ?? null,
          sourceControl: project.sourceControl,
          gitRepository: project.gitRepository,
        };

        const previousProjectItem = stableProjectItemsRef.current.get(nextProjectItem.id);
        const stableProjectItem =
          previousProjectItem && areSidebarProjectItemsEqual(previousProjectItem, nextProjectItem)
            ? previousProjectItem
            : nextProjectItem;

        nextStableProjectMap.set(stableProjectItem.id, stableProjectItem);
        return stableProjectItem;
      });

    stableProjectItemsRef.current = nextStableProjectMap;
    return nextItems;
  }, [organizationProjects, personalProjects, personalScoped]);

  React.useEffect(() => {
    if (projectItems.length === 0) return;

    const nextOrderedIds = buildOrderedProjects(projectItems, projectOrderIds).map(
      (project) => project.id,
    );
    if (areStringArraysEqual(projectOrderIds, nextOrderedIds)) return;
    setProjectOrderIds(nextOrderedIds);
  }, [projectItems, projectOrderIds]);

  const sortedProjects = React.useMemo(
    () => buildOrderedProjects(projectItems, projectOrderIds),
    [projectItems, projectOrderIds],
  );

  React.useEffect(() => {
    const nextProjectIdSet = new Set(projectItems.map((project) => project.id));

    setExpandedProjectIds((current) => {
      const filtered = current.filter((projectId) => nextProjectIdSet.has(projectId));
      return areStringArraysEqual(current, filtered) ? current : filtered;
    });

    setExpandedLaneIdsByProjectId((current) => {
      const filteredEntries = Object.entries(current)
        .filter(([projectId]) => nextProjectIdSet.has(projectId))
        .map(([projectId, laneIds]) => [projectId, dedupeStringArray(laneIds)] as const)
        .filter(([, laneIds]) => laneIds.length > 0);

      const next = Object.fromEntries(filteredEntries);
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      if (
        currentKeys.length === nextKeys.length &&
        currentKeys.every(
          (key) => key in next && areStringArraysEqual(current[key] ?? [], next[key] ?? []),
        )
      ) {
        return current;
      }

      return next;
    });
  }, [projectItems]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(
      PROJECT_SIDEBAR_STATE_STORAGE_KEY,
      JSON.stringify({
        expandedProjectIds,
        expandedLaneIdsByProjectId,
        projectOrderIds,
      } satisfies PersistedProjectSidebarState),
    );
  }, [expandedLaneIdsByProjectId, expandedProjectIds, projectOrderIds]);

  const currentProjectItem = React.useMemo(
    () => sortedProjects.find((project) => project.id === currentProjectId) ?? null,
    [currentProjectId, sortedProjects],
  );
  const currentCollabBranch = React.useMemo(
    () => (currentProjectItem ? resolveProjectCollabBranch(currentProjectItem) : "main"),
    [currentProjectItem],
  );
  const {
    laneState: currentLaneState,
    activeLane: currentActiveLane,
    refreshLaneState: refreshCurrentLaneState,
  } = useProjectLaneState({
    projectId: currentProjectId,
    projectPath: currentProjectPath,
    collabBranch: currentCollabBranch,
  });
  const currentVisibleActiveTileId = useProjectWorkbenchStore(
    React.useMemo(
      () => (state) => {
        if (!currentProjectId) return null;
        const scopeKey = buildWorkbenchScopeKey(currentProjectId, currentActiveLane?.id ?? null);
        const workbench = state.workbenches[scopeKey] ?? null;
        if (!workbench?.activeTileId) return null;
        const activeTile = workbench.tiles[workbench.activeTileId];
        return activeTile && activeTile.type !== "selection" ? activeTile.id : null;
      },
      [currentActiveLane?.id, currentProjectId],
    ),
  );

  const toggleExpandedProject = React.useCallback((projectId: string) => {
    setExpandedProjectIds((current) => {
      return current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId];
    });
  }, []);

  const toggleExpandedLane = React.useCallback((projectId: string, laneId: string) => {
    setExpandedLaneIdsByProjectId((current) => {
      const existing = current[projectId] ?? [];
      const nextLaneIds = existing.includes(laneId)
        ? existing.filter((id) => id !== laneId)
        : [...existing, laneId];

      if (nextLaneIds.length === 0) {
        if (!(projectId in current)) return current;
        const { [projectId]: _removed, ...remaining } = current;
        return remaining;
      }

      if (areStringArraysEqual(existing, nextLaneIds)) {
        return current;
      }

      return {
        ...current,
        [projectId]: nextLaneIds,
      };
    });
  }, []);

  const moveProject = React.useCallback(
    (projectId: string, direction: "up" | "down") => {
      setProjectOrderIds((current) => {
        const ensuredOrder = buildOrderedProjects(projectItems, current).map(
          (project) => project.id,
        );
        const index = ensuredOrder.indexOf(projectId);
        if (index === -1) return ensuredOrder;

        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= ensuredOrder.length) return ensuredOrder;

        const next = [...ensuredOrder];
        const [moved] = next.splice(index, 1);
        next.splice(targetIndex, 0, moved);
        return next;
      });
    },
    [projectItems],
  );

  const openLaneWorkbench = React.useCallback(
    async (
      project: SidebarProjectItem,
      laneId: string,
      options?: {
        openTile?: "assistantChat" | "browser" | "terminal" | "devServer";
        focusTileId?: string;
      },
    ) => {
      const workbenchStore = useProjectWorkbenchStore.getState();
      workbenchStore.actions.ensureWorkbench(project.id, laneId);

      const ensuredWorkbench =
        useProjectWorkbenchStore.getState().workbenches[
          buildWorkbenchScopeKey(project.id, laneId)
        ] ?? null;

      let nextOptions = options;
      if (!options?.openTile && !options?.focusTileId && ensuredWorkbench) {
        const hasVisibleTiles = ensuredWorkbench.order.some((tileId) => {
          const tile = ensuredWorkbench.tiles[tileId];
          return tile && tile.type !== "selection";
        });

        if (!hasVisibleTiles) {
          const selectionTileId =
            ensuredWorkbench.order.find(
              (tileId) => ensuredWorkbench.tiles[tileId]?.type === "selection",
            ) ?? null;

          if (selectionTileId) {
            nextOptions = { focusTileId: selectionTileId };
          }
        }
      }

      try {
        await window.electronAPI.project.setActiveLane({
          projectId: project.id,
          laneId,
        });
      } catch (error) {
        console.warn("[ProjectSidebar] Failed to switch lane", error);
      }

      navigate(buildWorkbenchHref(project.id, laneId, nextOptions));
    },
    [navigate],
  );

  const handleSyncCurrentProject = React.useCallback(async () => {
    if (!projectSyncContext?.projectPath) {
      return;
    }

    setIsSyncingProject(true);
    try {
      await projectSyncContext.triggerSync();
    } finally {
      setIsSyncingProject(false);
    }
  }, [projectSyncContext]);

  const isProjectsLoading =
    (personalScoped && personalProjects === undefined) ||
    (!personalScoped && convexOrganizationId && organizationProjects === undefined);
  const currentWorkbenchPath = currentProjectId
    ? `${buildProjectPath(currentProjectId)}/workbench`
    : null;
  const isOnCurrentProjectWorkbench = currentWorkbenchPath === location.pathname;
  const currentSelectionLevel: "none" | "project" | "lane" | "tile" = !currentProjectId
    ? "none"
    : isOnCurrentProjectWorkbench
      ? currentVisibleActiveTileId
        ? "tile"
        : "lane"
      : "project";

  const handleOpenProjectSettings = React.useCallback(
    (project: SidebarProjectItem) => {
      navigate(`${buildProjectPath(project.id)}/settings`);
    },
    [navigate],
  );

  const handleOpenProject = React.useCallback(
    async (project: SidebarProjectItem, localPath: string | null) => {
      try {
        const gitOpenResult = await prepareGitProjectForOpen({
          convex,
          project,
          localPath,
          userId: convexUserId,
          updateMemberLocalPath: convexUserId ? updateMemberLocalPath : undefined,
        });

        if (gitOpenResult.cancelled) {
          if (gitOpenResult.needsConflictResolution) {
            primeLocalProjectPath(project.id, gitOpenResult.localPath, project.slug);
            navigate(buildProjectPath(project.id, "conflicts"), {
              state: {
                projectId: project.id,
                projectSlug: project.slug,
                projectName: project.name,
                projectTemplate: project.template ?? undefined,
                localPath: gitOpenResult.localPath,
                syncMode: "git",
              },
            });
          }
          return;
        }

        primeLocalProjectPath(project.id, gitOpenResult.localPath, project.slug);
        navigate(buildProjectPath(project.id, "workbench"), {
          state: {
            projectId: project.id,
            projectSlug: project.slug,
            projectName: project.name,
            projectTemplate: project.template ?? undefined,
            localPath: gitOpenResult.localPath,
            syncMode: "git",
          },
        });
      } catch (error) {
        const presentation = formatProjectCloudAccessError(error, "Failed to prepare project", {
          workspaceScoped,
        });
        const response = await window.electronAPI.dialog.showMessageBox({
          type: presentation.isAccessError ? "warning" : "error",
          buttons: presentation.actionHref
            ? ["OK", presentation.actionLabel ?? "Open Settings"]
            : ["OK"],
          defaultId: 0,
          cancelId: 0,
          title: presentation.summary,
          message: presentation.summary,
          detail: presentation.detail ?? "",
          noLink: true,
        });

        if (presentation.actionHref && response.response === 1) {
          navigate(presentation.actionHref);
        }
      }
    },
    [convex, convexUserId, navigate, updateMemberLocalPath, workspaceScoped],
  );

  const handleOpenProjectFolder = React.useCallback(
    async (project: SidebarProjectItem, localPath: string | null) => {
      try {
        const resolvedLocalPath =
          localPath ??
          (await window.electronAPI.project.getLocalPath({
            slug: project.slug,
            projectId: project.id,
          }));

        if (!resolvedLocalPath) {
          throw new Error("Project folder is not available on this device.");
        }

        primeLocalProjectPath(project.id, resolvedLocalPath, project.slug);

        const result = await window.electronAPI.project.openFolder({
          projectPath: resolvedLocalPath,
        });

        if (!result.success) {
          throw new Error(result.error || "Failed to open project folder.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open project folder.";

        await window.electronAPI.dialog.showMessageBox({
          type: "error",
          title: "Open Folder Failed",
          message: "Failed to open project folder",
          detail: message,
        });
      }
    },
    [],
  );

  const handleStartRenameProject = React.useCallback((project: SidebarProjectItem) => {
    setProjectPendingRename(project);
    setRenameValue(project.name);
    setRenameError(null);
  }, []);

  const handleConfirmRenameProject = React.useCallback(
    async (nextName: string) => {
      if (!projectPendingRename || !convexUserId || isRenamingProject) return;

      const trimmedName = nextName.trim();
      if (!trimmedName || trimmedName === projectPendingRename.name) return;

      setIsRenamingProject(true);
      setRenameError(null);
      try {
        await updateProject({
          projectId: projectPendingRename._id,
          userId: convexUserId,
          name: trimmedName,
        });
        setProjectPendingRename(null);
      } catch (error) {
        const presentation = formatProjectRenameError(error);
        setRenameError(
          presentation.detail
            ? `${presentation.message} ${presentation.detail}`
            : presentation.message,
        );
      } finally {
        setIsRenamingProject(false);
      }
    },
    [convexUserId, isRenamingProject, projectPendingRename, updateProject],
  );

  const handleArchiveProject = React.useCallback(
    async (project: SidebarProjectItem) => {
      if (!convexUserId) return;

      const result = await window.electronAPI.dialog.showMessageBox({
        type: "warning",
        buttons: ["Cancel", "Archive Project"],
        defaultId: 0,
        cancelId: 0,
        title: "Archive Project",
        message: `Archive ${project.name}?`,
        detail: "The project will be hidden from active views and can be restored later.",
      });

      if (result.response !== 1) {
        return;
      }

      try {
        await archiveProject({
          projectId: project._id,
          userId: convexUserId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to archive project";
        const cleanMessage = message
          .replace(/^\[CONVEX.*?\]\s*/, "")
          .replace(/\s*Called by client$/, "");
        await window.electronAPI.dialog.showMessageBox({
          type: "error",
          title: "Archive Failed",
          message: "Failed to archive project",
          detail: cleanMessage,
        });
      }
    },
    [archiveProject, convexUserId],
  );

  const handleRestoreProject = React.useCallback(
    async (project: SidebarProjectItem) => {
      if (!convexUserId) return;

      const result = await window.electronAPI.dialog.showMessageBox({
        type: "question",
        buttons: ["Cancel", "Restore Project"],
        defaultId: 1,
        cancelId: 0,
        title: "Restore Project",
        message: `Restore ${project.name}?`,
        detail: "The project will return to active views.",
      });

      if (result.response !== 1) {
        return;
      }

      try {
        await restoreProject({
          projectId: project._id,
          userId: convexUserId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to restore project";
        const cleanMessage = message
          .replace(/^\[CONVEX.*?\]\s*/, "")
          .replace(/\s*Called by client$/, "");
        await window.electronAPI.dialog.showMessageBox({
          type: "error",
          title: "Restore Failed",
          message: "Failed to restore project",
          detail: cleanMessage,
        });
      }
    },
    [convexUserId, restoreProject],
  );

  const handleStartDeleteProject = React.useCallback((project: SidebarProjectItem) => {
    setProjectPendingDelete(project);
    setDeleteError(null);
  }, []);

  const handleConfirmDeleteProject = React.useCallback(
    async (confirmName: string) => {
      if (
        !projectPendingDelete ||
        !convexUserId ||
        isDeletingProject ||
        confirmName !== projectPendingDelete.name
      ) {
        return;
      }

      setIsDeletingProject(true);
      setDeleteError(null);
      try {
        await deleteProject({
          projectId: projectPendingDelete._id,
          userId: convexUserId,
          confirmName,
        });
        setProjectPendingDelete(null);
      } catch (error) {
        const presentation = formatProjectDeleteError(error);
        setDeleteError(
          presentation.detail
            ? `${presentation.message} ${presentation.detail}`
            : presentation.message,
        );
      } finally {
        setIsDeletingProject(false);
      }
    },
    [convexUserId, deleteProject, isDeletingProject, projectPendingDelete],
  );

  const handleSyncProject = React.useCallback(
    async (project: SidebarProjectItem) => {
      if (!currentProjectItem || currentProjectItem.id !== project.id) {
        return;
      }
      await handleSyncCurrentProject();
    },
    [currentProjectItem, handleSyncCurrentProject],
  );

  return (
    <>
      <Sidebar
        collapsible="offcanvas"
        windowChromeAware
        rootClassName={cn("h-full min-w-0 overflow-hidden", className)}
        rootStyle={{ "--sidebar-width": "14rem" } as React.CSSProperties}
        className="h-full min-w-0 z-20 sidebar-glass"
        {...props}
      >
        <SidebarContent className="gap-0 px-2 py-3">
          <div className="mb-4 space-y-1 px-1">
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]"
              onClick={(event) => void openProjectCreationMenu(event)}
            >
              <SquarePen className="size-4 shrink-0 text-muted-foreground/75" />
              <span className="truncate text-xs font-normal">New project</span>
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]"
              onClick={() => undefined}
            >
              <Clock3 className="size-4 shrink-0 text-muted-foreground/75" />
              <span className="min-w-0 flex-1 truncate text-xs font-normal">Automations</span>
            </button>
          </div>

          <div className="mb-3 flex items-center justify-between px-2">
            <div className="text-[14px] font-medium tracking-[-0.01em] text-muted-foreground/70">
              Projects
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 rounded-lg p-0 text-muted-foreground/70 hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]"
                aria-label="Project filters"
                onClick={() => undefined}
              >
                <SlidersHorizontal className="size-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            {isProjectsLoading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Loading projects…
              </div>
            ) : sortedProjects.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No projects in this workspace yet
              </div>
            ) : (
              sortedProjects.map((project, index) => (
                <SidebarProjectTreeItem
                  key={project.id}
                  project={project}
                  projectIndex={index}
                  projectCount={sortedProjects.length}
                  isCurrentProject={project.id === currentProjectId}
                  isExpanded={expandedProjectIds.includes(project.id)}
                  expandedLaneIds={expandedLaneIdsByProjectId[project.id] ?? []}
                  activeSelectionLevel={
                    project.id === currentProjectId ? currentSelectionLevel : "none"
                  }
                  activeTileId={project.id === currentProjectId ? currentVisibleActiveTileId : null}
                  currentProjectPath={project.id === currentProjectId ? currentProjectPath : null}
                  onToggleExpanded={toggleExpandedProject}
                  onToggleLaneExpanded={toggleExpandedLane}
                  onOpenProject={handleOpenProject}
                  onOpenProjectFolder={handleOpenProjectFolder}
                  onOpenProjectSettings={handleOpenProjectSettings}
                  onRenameProject={handleStartRenameProject}
                  onArchiveProject={handleArchiveProject}
                  onRestoreProject={handleRestoreProject}
                  onDeleteProject={handleStartDeleteProject}
                  onSyncProject={handleSyncProject}
                  onMoveProject={moveProject}
                  isSyncingProject={project.id === currentProjectId && isSyncingProject}
                  onOpenLaneWorkbench={openLaneWorkbench}
                  prefetchedLaneState={
                    project.id === currentProjectId ? currentLaneState : undefined
                  }
                  prefetchedActiveLane={
                    project.id === currentProjectId ? currentActiveLane : undefined
                  }
                  onRefreshActiveLaneState={
                    project.id === currentProjectId
                      ? async () => {
                          await refreshCurrentLaneState();
                        }
                      : undefined
                  }
                />
              ))
            )}
          </div>
        </SidebarContent>

        <SidebarSeparator />

        <SidebarFooter className="gap-3 p-3">
          <div>
            <NavUser user={user} onLogout={onLogout} />
          </div>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>
      <ProjectRenameDialog
        open={projectPendingRename !== null}
        onOpenChange={(open) => {
          if (!open && !isRenamingProject) {
            setProjectPendingRename(null);
            setRenameError(null);
          }
        }}
        currentName={projectPendingRename?.name ?? ""}
        value={renameValue}
        onValueChange={setRenameValue}
        onConfirm={handleConfirmRenameProject}
        isSaving={isRenamingProject}
        errorMessage={renameError}
      />
      <ProjectDeleteDialog
        open={projectPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isDeletingProject) {
            setProjectPendingDelete(null);
            setDeleteError(null);
          }
        }}
        projectName={projectPendingDelete?.name ?? ""}
        onConfirm={handleConfirmDeleteProject}
        isDeleting={isDeletingProject}
        errorMessage={deleteError}
      />
    </>
  );
}

"use client";

import * as React from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { ContextMenuItem } from "@cozea/assistant-contracts";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { useShallow } from "zustand/react/shallow";
import type {
  ProjectLaneDescriptor,
  ProjectLaneState,
} from "@shared/electronApiTypes";
import {
  AppWindow,
  ChevronRight,
  EllipsisVertical,
  Loader2,
  MonitorCog,
  SquarePen,
  SquareTerminal,
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
import { ProjectFavicon } from "./ProjectFavicon";

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
  activeSelectionLevel: "none" | "project" | "lane" | "tile";
  activeTileId: string | null;
  currentProjectPath: string | null;
  onToggleExpanded: (projectId: string) => void;
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
}

const PROJECT_SIDEBAR_STATE_STORAGE_KEY = "cozea.projectSidebar.state.v1";

interface PersistedProjectSidebarState {
  expandedProjectIds: string[];
  projectOrderIds: string[];
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


function readPersistedProjectSidebarState(): PersistedProjectSidebarState {
  if (typeof window === "undefined") {
    return {
      expandedProjectIds: [],
      projectOrderIds: [],
    };
  }

  try {
    const raw = window.localStorage.getItem(PROJECT_SIDEBAR_STATE_STORAGE_KEY);
    if (!raw) {
      return {
        expandedProjectIds: [],
        projectOrderIds: [],
      };
    }

    const parsed = JSON.parse(raw) as Partial<PersistedProjectSidebarState>;
    return {
      expandedProjectIds: dedupeStringArray(
        Array.isArray(parsed.expandedProjectIds) ? parsed.expandedProjectIds : [],
      ),
      projectOrderIds: dedupeStringArray(
        Array.isArray(parsed.projectOrderIds) ? parsed.projectOrderIds : [],
      ),
    };
  } catch {
    return {
      expandedProjectIds: [],
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

function ActiveLaneTiles(props: {
  activeLane: ProjectLaneDescriptor | null;
  laneWorkbenches: Record<string, WorkbenchProjectState>;
  activeSelectionLevel: "none" | "project" | "lane" | "tile";
  activeTileId: string | null;
  onOpenLaneWorkbench: (options?: {
    openTile?: "assistantChat" | "browser" | "terminal" | "devServer";
    focusTileId?: string;
  }) => void;
}) {
  const { activeLane, laneWorkbenches, activeSelectionLevel, activeTileId, onOpenLaneWorkbench } = props;
  const activeLaneWorkbench = activeLane ? (laneWorkbenches[activeLane.id] ?? null) : null;
  const { agents, surfaces } = React.useMemo(
    () => getTileCollections(activeLaneWorkbench),
    [activeLaneWorkbench],
  );
  const resolvedActiveTileId = activeSelectionLevel === "tile" ? activeTileId : null;

  if (agents.length === 0 && surfaces.length === 0) {
    return null;
  }

  return (
    <div className="mt-0.5 space-y-1">
      {agents.map((tile) => (
        <button
          key={tile.id}
          type="button"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md pr-2 pl-6 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]",
            resolvedActiveTileId === tile.id && "bg-[var(--sidebar-pill-hover-bg)] text-[var(--sidebar-pill-hover-fg)]",
          )}
          onClick={() => onOpenLaneWorkbench({ focusTileId: tile.id })}
        >
          <ProviderGlyph
            provider={tile.provider}
            className="size-4 shrink-0 text-muted-foreground/75"
          />
          <span className="min-w-0 flex-1 truncate text-xs">{tile.title}</span>
          <AgentStatusPill threadId={tile.threadId} />
        </button>
      ))}
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
              "flex w-full items-center gap-2.5 rounded-md pr-2 pl-6 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]",
              resolvedActiveTileId === tile.id && "bg-[var(--sidebar-pill-hover-bg)] text-[var(--sidebar-pill-hover-fg)]",
            )}
            onClick={() => onOpenLaneWorkbench({ focusTileId: tile.id })}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground/75" />
            <span className="min-w-0 flex-1 truncate text-xs">{tile.title}</span>
          </button>
        );
      })}
    </div>
  );
}

const SidebarProjectTreeItem = React.memo(
  function SidebarProjectTreeItem({
    project,
    projectIndex,
    projectCount,
    isCurrentProject,
    isExpanded,
    activeSelectionLevel,
    activeTileId,
    currentProjectPath,
    onToggleExpanded,
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
        <div
          className={cn(
            "group/project-item flex items-center gap-1 rounded-md px-2 py-0 transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]",
            activeSelectionLevel === "project" &&
              "bg-[var(--sidebar-pill-hover-bg)] text-[var(--sidebar-pill-hover-fg)]",
          )}
        >
          <button
            type="button"
            className={cn(
              "group flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left",
            )}
            onClick={() => onToggleExpanded(project.id)}
          >
            <ProjectFavicon cwd={projectIconPath} />
            <div className="min-w-0 flex flex-1 items-center gap-1.5 overflow-hidden">
              <span className="min-w-0 truncate text-xs font-normal">{project.name}</span>
              <ChevronRight
                className={cn(
                  "size-4 shrink-0 text-muted-foreground/75 transition-[transform,opacity] duration-150 group-hover/project-item:opacity-100 group-focus-visible:opacity-100 opacity-0",
                  isExpanded && "rotate-90",
                )}
              />
            </div>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 rounded-md p-0 text-muted-foreground/70 opacity-0 transition-opacity group-hover/project-item:opacity-100 group-focus-within/project-item:opacity-100 hover:bg-transparent hover:text-foreground"
            onClick={handleProjectMenuClick}
            aria-label={`${project.name} options`}
          >
            <EllipsisVertical className="size-3.5" />
          </Button>
        </div>

        <CollapsibleContent className="overflow-hidden">
          <ActiveLaneTiles
            activeLane={activeLane}
            laneWorkbenches={laneWorkbenches}
            activeSelectionLevel={activeSelectionLevel}
            activeTileId={activeTileId}
            onOpenLaneWorkbench={(options) => {
              if (!activeLane) return;
              void onOpenLaneWorkbench(project, activeLane.id, options);
            }}
          />
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
      prev.activeSelectionLevel === next.activeSelectionLevel &&
      prev.activeTileId === next.activeTileId &&
      prev.currentProjectPath === next.currentProjectPath &&
      prev.isSyncingProject === next.isSyncingProject &&
      prev.prefetchedLaneState === next.prefetchedLaneState &&
      prev.prefetchedActiveLane === next.prefetchedActiveLane &&
      prev.onToggleExpanded === next.onToggleExpanded &&
      prev.onOpenProject === next.onOpenProject &&
      prev.onOpenProjectFolder === next.onOpenProjectFolder &&
      prev.onOpenProjectSettings === next.onOpenProjectSettings &&
      prev.onRenameProject === next.onRenameProject &&
      prev.onArchiveProject === next.onArchiveProject &&
      prev.onRestoreProject === next.onRestoreProject &&
      prev.onDeleteProject === next.onDeleteProject &&
      prev.onSyncProject === next.onSyncProject &&
      prev.onMoveProject === next.onMoveProject &&
      prev.onOpenLaneWorkbench === next.onOpenLaneWorkbench
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

  }, [projectItems]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(
      PROJECT_SIDEBAR_STATE_STORAGE_KEY,
      JSON.stringify({
        expandedProjectIds,
        projectOrderIds,
      } satisfies PersistedProjectSidebarState),
    );
  }, [expandedProjectIds, projectOrderIds]);

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
          </div>

          <div className="mb-3 px-2">
            <div className="text-[14px] font-medium tracking-[-0.01em] text-muted-foreground/70">
              Projects
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
                  activeSelectionLevel={
                    project.id === currentProjectId ? currentSelectionLevel : "none"
                  }
                  activeTileId={project.id === currentProjectId ? currentVisibleActiveTileId : null}
                  currentProjectPath={project.id === currentProjectId ? currentProjectPath : null}
                  onToggleExpanded={toggleExpandedProject}
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

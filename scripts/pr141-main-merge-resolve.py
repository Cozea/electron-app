#!/usr/bin/env python3
from pathlib import Path

path = Path("apps/desktop/src/features/projects/layouts/ProjectLayout.tsx")
source = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    source = source.replace(old, new, 1)


replace_once(
    'import { resolveProjectSharedBranch } from "@/lib/git/projectRepositoryIntegration";\nimport type { WorkspaceResolutionAction } from "@shared/workspaceTypes";',
    'import { resolveProjectSharedBranch } from "@/lib/git/projectRepositoryIntegration";\nimport { downloadAuthorizedProjectRepository } from "@/features/collaboration/api/downloadAuthorizedProjectRepository";\nimport { ProjectCollaborationControl } from "@/features/collaboration/ProjectCollaborationControl";\nimport type { WorkspaceResolutionAction } from "@shared/workspaceTypes";',
    "collaboration imports",
)

replace_once(
    '  const runtimeWorkspaceId = activeWorkspaceId;\n\n  const isWorkbenchView = pathname.endsWith("/workbench");',
    '''  const runtimeWorkspaceId = activeWorkspaceId;\n  const [activeCollaborationBinding, setActiveCollaborationBinding] = useState<\n    import("@shared/collaborationDesktop").SessionWorkspaceBinding | null\n  >(null);\n  useEffect(() => {\n    let alive = true;\n    if (!activeWorkspaceId) {\n      setActiveCollaborationBinding(null);\n      return;\n    }\n    const refresh = () => {\n      void window.electronAPI.collaboration.bindingForWorkspace(activeWorkspaceId)\n        .then((binding) => {\n          if (alive) {\n            setActiveCollaborationBinding(\n              binding && ["active", "joining"].includes(binding.state) ? binding : null,\n            );\n          }\n        })\n        .catch(() => {\n          if (alive) setActiveCollaborationBinding(null);\n        });\n    };\n    refresh();\n    const unsubscribe = window.electronAPI.collaboration.runtime.onChanged(refresh);\n    return () => {\n      alive = false;\n      unsubscribe();\n    };\n  }, [activeWorkspaceId]);\n\n  const isWorkbenchView = pathname.endsWith("/workbench");''',
    "active collaboration binding",
)

replace_once(
    '''  const activeBranch = activeLane?.branch ?? collabBranch;\n  const collaborationEnabled =\n    shouldEnableProjectRuntime && Boolean(runtimeWorkspaceId) && Boolean(project?._id) && activeBranch === collabBranch;\n  const documentScopeId = useMemo(() => {\n    if (!routeProjectIdentity) {\n      return null;\n    }\n\n    if (!activeLane || activeLane.isCollab) {\n      return routeProjectIdentity;\n    }\n\n    return `${routeProjectIdentity}:${buildBranchSessionLaneId(activeLane.branch, collabBranch)}`;\n  }, [activeLane, collabBranch, routeProjectIdentity]);''',
    '''  const sessionLane = useMemo(() =>\n    activeCollaborationBinding\n      ? {\n          id: `session:${activeCollaborationBinding.sessionId}`,\n          name: "Live",\n          branch: activeCollaborationBinding.sessionBranch,\n          workspaceId: activeCollaborationBinding.workspaceId,\n          isCollab: true,\n          createdAt: activeCollaborationBinding.joinedAt,\n          updatedAt: activeCollaborationBinding.joinedAt,\n        }\n      : null,\n    [activeCollaborationBinding],\n  );\n  const effectiveActiveLane = sessionLane ?? activeLane;\n  const activeBranch = effectiveActiveLane?.branch ?? collabBranch;\n  const collaborationEnabled = Boolean(\n    shouldEnableProjectRuntime && runtimeWorkspaceId && project?._id && activeCollaborationBinding,\n  );\n  const documentScopeId = useMemo(() => {\n    if (!routeProjectIdentity) {\n      return null;\n    }\n\n    if (activeCollaborationBinding) return `session:${activeCollaborationBinding.sessionId}`;\n    if (!activeLane || activeLane.isCollab) return routeProjectIdentity;\n    return `${routeProjectIdentity}:${buildBranchSessionLaneId(activeLane.branch, collabBranch)}`;\n  }, [activeCollaborationBinding, activeLane, collabBranch, routeProjectIdentity]);''',
    "session lane cutover",
)

replace_once(
    '''  const presenceHeaderAddon = useMemo(\n    () => (\n      <ProjectPresenceHeaderAddon\n        projectId={presenceGateOpen ? project?._id ?? null : null}\n        principalId={presenceGateOpen ? principalId ?? null : null}\n        isWorkbenchView={isWorkbenchView}\n        projectBasePath={projectBasePath}\n      />\n    ),\n    [\n      presenceGateOpen,\n      project?._id,\n      principalId,\n      isConvexAuthReady,\n      shouldEnableProjectRuntime,\n      isWorkbenchView,\n      projectBasePath,\n    ],\n  );''',
    '''  const presenceHeaderAddon = useMemo(\n    () => (\n      <div className="flex items-center gap-1">\n        <ProjectPresenceHeaderAddon\n          projectId={presenceGateOpen ? project?._id ?? null : null}\n          principalId={presenceGateOpen ? principalId ?? null : null}\n          isWorkbenchView={isWorkbenchView}\n          projectBasePath={projectBasePath}\n        />\n        {project?._id && activeWorkspaceId ? (\n          <ProjectCollaborationControl\n            projectId={String(project._id)}\n            sourceWorkspaceId={activeCollaborationBinding?.sourceWorkspaceId ?? activeWorkspaceId}\n            defaultBranch={collabBranch}\n          />\n        ) : null}\n      </div>\n    ),\n    [\n      presenceGateOpen,\n      project?._id,\n      principalId,\n      isConvexAuthReady,\n      shouldEnableProjectRuntime,\n      isWorkbenchView,\n      projectBasePath,\n      activeWorkspaceId,\n      activeCollaborationBinding,\n      collabBranch,\n    ],\n  );''',
    "live control header",
)

replace_once(
    '''      const repoUrl =\n        (project as { repoSource?: { repoUrl?: string | null } | null } | null | undefined)?.repoSource?.repoUrl ??\n        (project as { sourceControl?: { repoUrl?: string | null } | null } | null | undefined)?.sourceControl?.repoUrl ??\n        null;\n      const branch =\n        (project as { repoSource?: { branch?: string | null } | null } | null | undefined)?.repoSource?.branch ??\n        (project as { sourceControl?: { defaultBranch?: string | null } | null } | null | undefined)?.sourceControl?.defaultBranch ??\n        undefined;''',
    '''      const repoSource = (project as {\n        repoSource?: { provider?: string | null; repoUrl?: string | null; branch?: string | null } | null;\n      } | null | undefined)?.repoSource ?? null;\n      const sourceControl = (project as {\n        sourceControl?: { provider?: string | null; repoUrl?: string | null; defaultBranch?: string | null } | null;\n      } | null | undefined)?.sourceControl ?? null;\n      const repoUrl = repoSource?.repoUrl ?? sourceControl?.repoUrl ?? null;\n      const branch = repoSource?.branch ?? sourceControl?.defaultBranch ?? undefined;\n      const githubAuthorized =\n        repoSource?.provider?.trim().toLowerCase() === "github" ||\n        sourceControl?.provider?.trim().toLowerCase() === "github";''',
    "repository descriptor",
)

replace_once(
    '''          case "clone": {\n            if (!repoUrl) {''',
    '''          case "clone": {\n            if (githubAuthorized) {\n              await downloadAuthorizedProjectRepository({ projectId, slug });\n              refreshWorkspace();\n              break;\n            }\n            if (!repoUrl) {''',
    "authorized clone",
)

replace_once(
    '      laneState,\n      activeLane,\n      collabLane,',
    '      laneState,\n      activeLane: effectiveActiveLane,\n      collabLane,',
    "route context active lane",
)
replace_once(
    '      activeLane,\n      collabBranch,\n      collabLane,',
    '      effectiveActiveLane,\n      collabBranch,\n      collabLane,',
    "route context dependency",
)
replace_once(
    '          laneId={activeLane?.id ?? laneState?.activeLaneId ?? laneState?.collabLaneId ?? null}',
    '          laneId={effectiveActiveLane?.id ?? laneState?.activeLaneId ?? null}',
    "runtime lane id",
)

path.write_text(source)
print("Resolved ProjectLayout using current main navigation plus explicit collaboration session behavior")

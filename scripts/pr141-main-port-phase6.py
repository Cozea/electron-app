#!/usr/bin/env python3
from pathlib import Path
import re
import subprocess

SOURCE = "origin/codex/collaboration-v2-complete"


def source(path: str) -> str:
    return subprocess.check_output(["git", "show", f"{SOURCE}:{path}"], text=True)


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def principalize(text: str) -> str:
    replacements = [
        ("createdByUserId", "createdByPrincipalId"),
        ("commitLeaseUserId", "commitLeasePrincipalId"),
        ("publishedByUserId", "publishedByPrincipalId"),
        ("actorUserId", "actorPrincipalId"),
        ("by_session_and_user", "by_session_and_principal"),
        ("by_project_and_user", "by_project_and_principal"),
        ("by_user_and_last_seen", "by_principal_and_last_seen"),
        ('Id<"users">', 'Id<"devicePrincipals">'),
        ('v.id("users")', 'v.id("devicePrincipals")'),
    ]
    for before, after in replacements:
        text = text.replace(before, after)
    text = re.sub(r"\buserId\b", "principalId", text)
    return text


shared_files = [
    "shared/AcknowledgedCollaborationState.ts",
    "shared/CollaborationTransport.ts",
    "shared/SessionFileDocument.ts",
    "shared/collaborationCheckpoint.ts",
    "shared/collaborationCipher.ts",
    "shared/collaborationCommitReview.ts",
    "shared/collaborationDesktop.ts",
    "shared/collaborationFileInitialization.ts",
    "shared/collaborationPaths.ts",
    "shared/collaborationRecovery.ts",
    "shared/collaborationRetainedWorkspaces.ts",
    "shared/collaborationRuntime.ts",
    "shared/collaborationTargetBranch.ts",
    "shared/collaborationWire.ts",
    "shared/durableQuit.ts",
    "shared/nativeWorkspaceAuthority.ts",
    "shared/nativeWorkspaceIpc.ts",
    "shared/verifiedChildProcessStop.ts",
]

for path in shared_files:
    write(path, principalize(source(path)))

electron_files = [
    "AuthorizedRepositoryDownloader.ts",
    "CollaborationSessionRuntime.ts",
    "CollaborationShutdown.ts",
    "DeviceCollaborationGateway.ts",
    "DurableSessionStore.ts",
    "InitializationBasisCleanup.ts",
    "NativeWorkspaceAuthorizer.ts",
    "NativeWorkspaceBridge.ts",
    "RecoveryStorageBudget.ts",
    "RecoveryStorageCleanup.ts",
    "SessionCheckpointClient.ts",
    "SessionFileProjection.ts",
    "SessionKeyCache.ts",
    "SessionKeyManager.ts",
    "SessionKeyRecovery.ts",
    "SessionOfflineRecovery.ts",
    "SessionRuntimeHost.ts",
    "SessionWorkspaceCoordinator.ts",
    "binaryReview.ts",
    "registerCollaborationHandlers.ts",
    "workspacePolicy.ts",
]
for name in electron_files:
    path = f"apps/desktop/electron/collaboration/{name}"
    write(path, principalize(source(path)))

# Generation-3 target-branch identity is useful to the current session model.
session_path = Path("shared/collaborationSession.ts")
session = session_path.read_text()
if "targetCommitSha?: string" not in session:
    session = session.replace(
        "  targetBranch: string\n  sessionBranch: string\n",
        "  targetBranch: string\n  /** Immutable verified target SHA at creation. */\n  targetCommitSha?: string\n  sessionBranch: string\n",
        1,
    )
    session = session.replace(
        '  const baseCommitSha = assertGitCommitSha(session.baseCommitSha, "Base commit SHA")\n',
        '  const baseCommitSha = assertGitCommitSha(session.baseCommitSha, "Base commit SHA")\n  if (session.targetCommitSha !== undefined) assertGitCommitSha(session.targetCommitSha, "Starting target commit SHA")\n',
        1,
    )
session_path.write_text(session)

# Extend the current-main catalog with a prepare-before-bind managed workspace primitive.
catalog_path = Path("apps/desktop/electron/workspaces/WorkspaceCatalog.ts")
catalog = catalog_path.read_text()
interface_anchor = '''  readonly createForProject: (\n    req: CreateWorkspaceForProjectRequest,\n  ) => Effect.Effect<CreateWorkspaceForProjectResult>\n'''
if "readonly createPreparedWorkspace" not in catalog:
    if interface_anchor not in catalog:
        raise SystemExit("WorkspaceCatalog createForProject interface anchor missing")
    catalog = catalog.replace(
        interface_anchor,
        interface_anchor + '''\n  /** Allocate a Cozea-managed folder, prepare it, then publish its catalog binding. */\n  readonly createPreparedWorkspace: (\n    req: CreateWorkspaceForProjectRequest,\n    prepare: (directory: string) => Promise<void>,\n    eventSource?: string,\n  ) => Effect.Effect<CreateWorkspaceForProjectResult>\n''',
        1,
    )

implementation_anchor = '''    // ── attachExistingFolder ────────────────────────────────────────────────\n'''
if "const createPreparedWorkspace =" not in catalog:
    if implementation_anchor not in catalog:
        raise SystemExit("WorkspaceCatalog prepared workspace insertion anchor missing")
    prepared_impl = r'''    /**
     * Allocate and prepare a managed workspace transactionally from the catalog's
     * perspective. No workspace row or active-lane change becomes visible until
     * the caller's preparation succeeds. Failed preparation removes only the
     * newly allocated Cozea-owned directory.
     */
    const createPreparedWorkspace = (
      req: CreateWorkspaceForProjectRequest,
      prepare: (directory: string) => Promise<void>,
      eventSource = "prepared",
    ): Effect.Effect<CreateWorkspaceForProjectResult> =>
      Effect.gen(function* () {
        const { projectId, slug, rootId, rootPathOverride, setActive = false } = req
        const resolvedRoot = yield* resolveLocalRoot(rootId, rootPathOverride)
        const baseDir = resolvedRoot.realPath
        yield* cleanupMissingWorkspaceBindingsUnderRoot(resolvedRoot.rootId, baseDir).pipe(
          Effect.catch(() => Effect.void),
        )
        const targetPath = yield* Effect.tryPromise({
          try: () => findAvailablePath(baseDir, slug),
          catch: (error) => new Error(String(error)),
        })
        yield* Effect.tryPromise({
          try: () => fs.mkdir(targetPath, { recursive: false }),
          catch: (error) => new Error(`Failed to allocate managed workspace: ${String(error)}`),
        })

        const preparation = yield* Effect.result(
          Effect.tryPromise({
            try: () => prepare(targetPath),
            catch: (error) => new Error(`Managed workspace preparation failed: ${String(error)}`),
          }),
        )
        if (preparation._tag === "Failure") {
          yield* Effect.tryPromise({
            try: () => fs.rm(targetPath, { recursive: true, force: true }),
            catch: () => undefined,
          }).pipe(Effect.catch(() => Effect.void))
          return { success: false, error: formatWorkspaceCatalogError(preparation.failure) }
        }

        const bindResult = yield* bindExistingFolder({
          projectId,
          folderPath: targetPath,
          writeMarker: true,
          setActive,
          source: "clone",
          storageOwnership: "managed",
          managedRootId: resolvedRoot.rootId,
          markerPolicy: "required",
        })
        if (!bindResult.success || !bindResult.workspace) {
          yield* Effect.tryPromise({
            try: () => fs.rm(targetPath, { recursive: true, force: true }),
            catch: () => undefined,
          }).pipe(Effect.catch(() => Effect.void))
          return { success: false, error: bindResult.error ?? "Prepared workspace bind failed" }
        }
        yield* emitEvent(bindResult.workspace.workspaceId, projectId, "workspace.prepared", {
          eventSource,
        }).pipe(Effect.catch(() => Effect.void))
        return { success: true, workspace: bindResult.workspace }
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed({ success: false, error: formatWorkspaceCatalogError(error) }),
        ),
      )

'''
    catalog = catalog.replace(implementation_anchor, prepared_impl + implementation_anchor, 1)

return_anchor = '''      createForProject: (req) => createForProject(req).pipe(Effect.orDie),\n'''
if "createPreparedWorkspace: (req, prepare" not in catalog:
    if return_anchor not in catalog:
        raise SystemExit("WorkspaceCatalog service return anchor missing")
    catalog = catalog.replace(
        return_anchor,
        return_anchor + '      createPreparedWorkspace: (req, prepare, eventSource) => createPreparedWorkspace(req, prepare, eventSource).pipe(Effect.orDie),\n',
        1,
    )
catalog_path.write_text(catalog)

print("PR141 phase 6 generation-3 runtime core staged on current main")

#!/usr/bin/env python3
from pathlib import Path
import re

# Current main's purge helper returns a deletion count, not an explicit next-stage object.
projects_path = Path("convex/projects.ts")
projects = projects_path.read_text()
for old in (
    'return { deleted: rows.length, nextStage: rows.length === 0 ? 20 : 19 }',
    'return { deleted: rows.length, nextStage: rows.length === 0 ? 21 : 20 }',
    'return { deleted: rows.length, nextStage: rows.length === 0 ? 22 : 21 }',
):
    projects = projects.replace(old, 'return rows.length')
projects_path.write_text(projects)

# Keep the canonical repository fallback expressions syntactically unambiguous.
layout_path = Path("apps/desktop/src/features/projects/layouts/ProjectLayout.tsx")
layout = layout_path.read_text()
layout = re.sub(
    r'''const repoUrl = canonicalRepo\?\.url\?\.trim\(\) \|\|\s*\n\s*(\(project as \{ sourceControl\?: \{ repoUrl\?: string \| null \} \| null \} \| null \| undefined\)\?\.sourceControl\?\.repoUrl) \?\?\s*\n\s*null;''',
    r'''const repoUrl = canonicalRepo?.url?.trim() || (\1 ?? null);''',
    layout,
)
layout = re.sub(
    r'''const branch = canonicalRepo\?\.defaultBranch\?\.trim\(\) \|\|\s*\n\s*(\(project as \{ sourceControl\?: \{ defaultBranch\?: string \| null \} \| null \} \| null \| undefined\)\?\.sourceControl\?\.defaultBranch) \?\?\s*\n\s*undefined;''',
    r'''const branch = canonicalRepo?.defaultBranch?.trim() || (\1 ?? undefined);''',
    layout,
)
layout_path.write_text(layout)

# Route every public collaboration-session function through current main's canonical
# authenticated function builders. Gateway-secret server calls are already supported
# by those builders, so the server-only mutations retain their authority boundary.
session_path = Path("convex/collaborationSessions.ts")
session = session_path.read_text()
session = session.replace(
'''import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
''',
'''import type { MutationCtx, QueryCtx } from "./_generated/server"
import {
  authenticatedMutation as mutation,
  authenticatedQuery as query,
} from "./lib/authenticatedFunctions"
''',
)
old_branch = '''    branch.includes("//") ||
    /[\\u0000-\\u0020~^:?*\\\\[\\]]/.test(branch)
'''
new_branch = '''    branch.includes("//") ||
    [...branch].some((character) => character.charCodeAt(0) <= 0x20) ||
    /[~^:?*\\\\[\\]]/.test(branch)
'''
session = session.replace(old_branch, new_branch)
session_path.write_text(session)

# The room authorization endpoint is gateway-only at runtime, but it still uses
# the canonical builder so the generic authority invariant can verify it.
room_auth_path = Path("convex/collaborationRoomAuthorization.ts")
room_auth = room_auth_path.read_text()
room_auth = room_auth.replace(
    'import { query } from "./_generated/server"',
    'import { authenticatedQuery as query } from "./lib/authenticatedFunctions"',
)
room_auth_path.write_text(room_auth)

# Extend the generic caller-identity guard to principal-native field names so a
# future endpoint cannot accidentally accept a forged actor principal.
auth_path = Path("convex/lib/authenticatedFunctions.ts")
auth = auth_path.read_text()
if '"createdByPrincipalId"' not in auth:
    auth = auth.replace(
        '  "deletedBy", "createdByUserId", "addedByUserId",\n',
        '  "deletedBy", "createdByUserId", "addedByUserId",\n  "createdByPrincipalId", "actorPrincipalId", "viewerPrincipalId",\n',
        1,
    )
auth = auth.replace(
    '/^(?:actor|viewer|requester|inviter|invited|added|deleted|created)UserId$/.test(field)',
    '/^(?:actor|viewer|requester|inviter|invited|added|deleted|created)(?:User|Principal)Id$/.test(field)',
)
auth_path.write_text(auth)

# Generation-3 runs on the canonical machine-backed principal contract. Remove
# stale device aliases left at use sites after the descriptor itself was ported.
transport_path = Path("shared/CollaborationTransport.ts")
transport = transport_path.read_text()
transport = transport.replace(
    'session.deviceId !== this.session.deviceId',
    'session.identityKey !== this.session.identityKey',
)
transport = transport.replace(
    'userName: typeof metadata.userName === "string" ? metadata.userName : null,',
    'displayName: typeof metadata.displayName === "string" ? metadata.displayName : null,',
)
transport_path.write_text(transport)

host_path = Path("apps/desktop/electron/collaboration/SessionRuntimeHost.ts")
host = host_path.read_text().replace('.supplyWaitingDevices(', '.supplyWaitingPrincipals(')
host_path.write_text(host)

# Main-process device authentication uses the same identity payload as the
# renderer session path; presentation labels are not part of the crypto identity.
gateway_path = Path("apps/desktop/electron/collaboration/DeviceCollaborationGateway.ts")
gateway = gateway_path.read_text().replace(
    'identityKey: identity.identityKey, deviceLabel: identity.deviceLabel, platform: identity.platform,',
    'identityKey: identity.identityKey, platform: identity.platform,',
)
gateway_path.write_text(gateway)

# ---------------------------------------------------------------------------
# Generation-3 desktop activation
# ---------------------------------------------------------------------------

# The coordinator consumes the canonical nested repository credential response.
coordinator_path = Path("apps/desktop/electron/collaboration/SessionWorkspaceCoordinator.ts")
coordinator = coordinator_path.read_text()
if 'CollaborationRepositoryCredentialResponse' not in coordinator:
    coordinator = coordinator.replace(
        'import { assertSharedFilePath } from "../../../../shared/collaborationPaths"\n',
        'import { assertSharedFilePath } from "../../../../shared/collaborationPaths"\nimport type { CollaborationRepositoryCredentialResponse } from "../../../../shared/collaborationRepository"\n',
        1,
    )
coordinator = coordinator.replace(
    'credential(projectId: string, sessionId: string, operation: "read" | "write", accessToken: string): Promise<{ cloneUrl: string; token: string; expiresAt: number; repositoryId: string }>',
    'credential(projectId: string, sessionId: string, operation: "read" | "write", accessToken: string): Promise<CollaborationRepositoryCredentialResponse>',
)
coordinator = coordinator.replace(
'''    if (credential.expiresAt <= this.now() || credential.repositoryId !== authority.session.repositoryId ||
      canonicalRepository(credential.cloneUrl) !== canonicalRepository(authority.cloneUrl)) {
      throw new Error("Repository credentials expired or repository identity changed")
    }
''',
'''    const repository = credential.repository
    if (credential.expiresAt <= this.now() || credential.operation !== operation ||
      repository.repositoryId !== authority.session.repositoryId ||
      canonicalRepository(repository.cloneUrl) !== canonicalRepository(authority.cloneUrl)) {
      throw new Error("Repository credentials expired or repository identity changed")
    }
''',
)
coordinator_path.write_text(coordinator)

# Git blob reads used by collaboration must be byte-exact and bounded. Keep the
# existing string API as the default so the rest of the desktop remains unchanged.
git_path = Path("apps/desktop/electron/gitRuntime.ts")
git = git_path.read_text()
git = git.replace(
'''  stdout: string
  stderr: string
''',
'''  stdout: string
  stdoutBytes?: Uint8Array
  stderr: string
''',
1,
)
start = git.index('export async function runGitCommand(')
end = git.index('\nfunction parseGitVersion', start)
run_git = r'''export async function runGitCommand(
  args: string[],
  options?: {
    cwd?: string
    env?: Record<string, string>
    stdin?: string
    timeoutMs?: number
    captureStdoutBytes?: boolean
    maxOutputBytes?: number
  }
): Promise<GitCommandResult> {
  const resolved = resolveGitExecutablePath()
  if (!resolved.path) {
    return {
      success: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      executablePath: "",
      source: resolved.source,
      error: "Git executable not found",
    }
  }

  return new Promise((resolve) => {
    const child = spawn(resolved.path!, args, {
      cwd: options?.cwd,
      env: createGitEnv(options?.env),
      stdio: ["pipe", "pipe", "pipe"],
    })

    const captureStdoutBytes = options?.captureStdoutBytes === true
    const maximum = options?.maxOutputBytes
    if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum <= 0)) {
      child.kill("SIGKILL")
      resolve({
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        executablePath: resolved.path!,
        source: resolved.source,
        error: "Invalid Git stdout limit",
      })
      return
    }

    let stdout = ""
    const stdoutChunks: Buffer[] = []
    let stdoutLength = 0
    let stderr = ""
    let timedOut = false
    let outputLimitExceeded = false
    let timeout: NodeJS.Timeout | null = null
    let settled = false

    const finish = (result: GitCommandResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    if (options?.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true
        try {
          child.kill("SIGKILL")
        } catch {
          // ignore kill failures
        }
      }, options.timeoutMs)
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (captureStdoutBytes) {
        stdoutLength += bytes.length
        if (maximum !== undefined && stdoutLength > maximum) {
          outputLimitExceeded = true
          try { child.kill("SIGKILL") } catch { /* close will report the bounded failure */ }
          return
        }
        stdoutChunks.push(bytes)
        return
      }
      stdout += bytes.toString()
    })

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout)
      finish({
        success: false,
        exitCode: null,
        stdout,
        ...(captureStdoutBytes && !outputLimitExceeded
          ? { stdoutBytes: new Uint8Array(Buffer.concat(stdoutChunks)) }
          : {}),
        stderr,
        executablePath: resolved.path!,
        source: resolved.source,
        error: error.message || "Failed to execute git command",
      })
    })

    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout)
      finish({
        success: !timedOut && !outputLimitExceeded && code === 0,
        exitCode: code,
        stdout,
        ...(captureStdoutBytes && !outputLimitExceeded
          ? { stdoutBytes: new Uint8Array(Buffer.concat(stdoutChunks)) }
          : {}),
        stderr,
        executablePath: resolved.path!,
        source: resolved.source,
        error: outputLimitExceeded
          ? "Git stdout exceeded the collaboration byte limit"
          : timedOut
            ? "Git command timed out"
            : undefined,
      })
    })

    if (options?.stdin !== undefined) {
      child.stdin.write(options.stdin)
    }
    child.stdin.end()
  })
}
'''
git = git[:start] + run_git + git[end:]
git_path.write_text(git)

# Forward the coordinator's byte/string Git contract exactly; cancellation is
# owned by the repository downloader, while session Git operations are serialized
# by the coordinator itself.
handlers_path = Path("apps/desktop/electron/collaboration/registerCollaborationHandlers.ts")
handlers = handlers_path.read_text()
handlers = handlers.replace(
'''    git: async (args, options) => {
      if (options.signal?.aborted) throw new Error("Collaboration Git operation cancelled")
      const result = await runGitCommand(args, { cwd: options.cwd, env: options.env, timeoutMs: 120_000 })
      if (options.signal?.aborted) throw new Error("Collaboration Git operation cancelled")
      return result
    },
''',
'''    git: async (args, options) => runGitCommand(args, {
      cwd: options.cwd,
      env: options.env,
      stdin: options.stdin,
      captureStdoutBytes: options.captureStdoutBytes,
      maxOutputBytes: options.maxOutputBytes,
      timeoutMs: 120_000,
    }),
''',
)
handlers_path.write_text(handlers)

# ElectronAPI exposes the complete main-owned collaboration surface.
electron_types_path = Path("shared/electronApiTypes.ts")
electron_types = electron_types_path.read_text()
if "import type { CollaborationDesktopAPI } from './collaborationDesktop'" not in electron_types:
    electron_types = electron_types.replace(
        "import type { Session } from './types'\n",
        "import type { Session } from './types'\nimport type { CollaborationDesktopAPI } from './collaborationDesktop'\n",
        1,
    )
if '  collaboration: CollaborationDesktopAPI\n' not in electron_types:
    shell_anchor = '\n  shell: {'
    collab_start = electron_types.index('  collab: {')
    shell_index = electron_types.index(shell_anchor, collab_start)
    electron_types = electron_types[:shell_index] + '\n  collaboration: CollaborationDesktopAPI\n' + electron_types[shell_index:]
electron_types_path.write_text(electron_types)

# Preload forwards typed methods/events but never exposes ipcRenderer itself.
preload_path = Path("apps/desktop/electron/preload.ts")
preload = preload_path.read_text()
if "import type { CollaborationDesktopAPI } from '../../../shared/collaborationDesktop'" not in preload:
    preload = preload.replace(
        "import type { WorkspaceCatalogSnapshot } from '../../../shared/workspaceTypes'\n",
        "import type { WorkspaceCatalogSnapshot } from '../../../shared/workspaceTypes'\nimport type { CollaborationDesktopAPI } from '../../../shared/collaborationDesktop'\n",
        1,
    )
bridge_marker = "const collaborationBridge: CollaborationDesktopAPI ="
if bridge_marker not in preload:
    expose_anchor = "contextBridge.exposeInMainWorld('electronAPI', {"
    bridge = r'''const collaborationBridge: CollaborationDesktopAPI = {
  downloadRepository: (input) => ipcRenderer.invoke('collaboration:downloadRepository', input),
  cancelDownload: (projectId) => ipcRenderer.invoke('collaboration:cancelDownload', projectId),
  onDownloadProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress)
    ipcRenderer.on('collaboration:downloadProgress', handler)
    return () => ipcRenderer.removeListener('collaboration:downloadProgress', handler)
  },
  runtime: {
    recoveryEntries: (sessionId) => ipcRenderer.invoke('collaboration:runtimeRecoveryEntries', sessionId),
    recoveredFiles: (sessionId) => ipcRenderer.invoke('collaboration:runtimeRecoveredFiles', sessionId),
    resolveRecovered: (input) => ipcRenderer.invoke('collaboration:runtimeResolveRecovered', input),
    recoveryInventory: () => ipcRenderer.invoke('collaboration:runtimeRecoveryInventory'),
    cleanupRecovery: (sessionId) => ipcRenderer.invoke('collaboration:runtimeCleanupRecovery', sessionId),
    setup: (organizationId) => ipcRenderer.invoke('collaboration:runtimeSetup', organizationId),
    resolve: (input) => ipcRenderer.invoke('collaboration:runtimeResolve', input),
    control: (input) => ipcRenderer.invoke('collaboration:control', input),
    open: (input) => ipcRenderer.invoke('collaboration:runtimeOpen', input),
    active: (projectId) => ipcRenderer.invoke('collaboration:runtimeActive', projectId),
    snapshot: (sessionId) => ipcRenderer.invoke('collaboration:runtimeSnapshot', sessionId),
    openFile: (input) => ipcRenderer.invoke('collaboration:runtimeOpenFile', input),
    editorState: (sessionId) => ipcRenderer.invoke('collaboration:runtimeEditorState', sessionId),
    edit: (input) => ipcRenderer.invoke('collaboration:runtimeEdit', input),
    createFile: (input) => ipcRenderer.invoke('collaboration:runtimeCreateFile', input),
    renameFile: (input) => ipcRenderer.invoke('collaboration:runtimeRenameFile', input),
    deleteFile: (input) => ipcRenderer.invoke('collaboration:runtimeDeleteFile', input),
    restoreFile: (input) => ipcRenderer.invoke('collaboration:runtimeRestoreFile', input),
    binaryCandidates: (sessionId) => ipcRenderer.invoke('collaboration:runtimeBinaryCandidates', sessionId),
    reviewPrepared: (input) => ipcRenderer.invoke('collaboration:runtimeReviewPrepared', input),
    commit: (input) => ipcRenderer.invoke('collaboration:runtimeCommit', input),
    push: (input) => ipcRenderer.invoke('collaboration:runtimePush', input),
    prepared: (sessionId) => ipcRenderer.invoke('collaboration:runtimePrepared', sessionId),
    discard: (sessionId) => ipcRenderer.invoke('collaboration:runtimeDiscard', sessionId),
    importChanges: (input) => ipcRenderer.invoke('collaboration:runtimeImport', input),
    leave: (input) => ipcRenderer.invoke('collaboration:runtimeLeave', input),
    retry: (sessionId) => ipcRenderer.invoke('collaboration:runtimeRetry', sessionId),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, sessionId: unknown) => {
        if (typeof sessionId === 'string') listener(sessionId)
      }
      ipcRenderer.on('collaboration:runtimeChanged', handler)
      return () => ipcRenderer.removeListener('collaboration:runtimeChanged', handler)
    },
  },
  prepare: (input) => ipcRenderer.invoke('collaboration:prepare', input),
  leave: (input) => ipcRenderer.invoke('collaboration:leave', input),
  getBinding: (sessionId) => ipcRenderer.invoke('collaboration:getBinding', sessionId),
  bindingForWorkspace: (workspaceId) => ipcRenderer.invoke('collaboration:bindingForWorkspace', workspaceId),
  inspectImportableChanges: (workspaceId) => ipcRenderer.invoke('collaboration:inspectImport', workspaceId),
  readReviewedImport: (input) => ipcRenderer.invoke('collaboration:readImport', input),
  prepareCommit: (input) => ipcRenderer.invoke('collaboration:prepareCommit', input),
  pushPrepared: (input) => ipcRenderer.invoke('collaboration:pushPrepared', input),
  adoptPublished: (input) => ipcRenderer.invoke('collaboration:adoptPublished', input),
}

'''
    preload = preload.replace(expose_anchor, bridge + expose_anchor, 1)
if '  collaboration: collaborationBridge,\n' not in preload:
    collab_index = preload.index('  collab: {')
    shell_index = preload.index('\n  shell: {', collab_index)
    preload = preload[:shell_index] + '\n  collaboration: collaborationBridge,' + preload[shell_index:]
preload_path.write_text(preload)

# Main process owns the runtime for the application lifetime. Registration waits
# for Electron readiness because userData is not available safely at module load.
main_path = Path("apps/desktop/electron/main.ts")
main = main_path.read_text()
if 'import { registerCollaborationHandlers } from \'./collaboration/registerCollaborationHandlers\'' not in main:
    main = main.replace(
        "import { registerYjsHandlers } from './ipc/registerYjsHandlers'\n",
        "import { registerYjsHandlers } from './ipc/registerYjsHandlers'\nimport { registerCollaborationHandlers } from './collaboration/registerCollaborationHandlers'\nimport { shutdownCollaboration } from './collaboration/CollaborationShutdown'\nimport { createDurableQuitHandler } from '../../../shared/durableQuit'\n",
        1,
    )
registration_anchor = "  registerWorkspaceHandlers(ipcMain, { loadSettings, saveSettings })\n"
if "registerCollaborationHandlers(ipcMain, app.getPath('userData'))" not in main:
    main = main.replace(
        registration_anchor,
        registration_anchor + "  registerCollaborationHandlers(ipcMain, app.getPath('userData'))\n",
        1,
    )
# Do not dispose the workspace catalog before collaboration has persisted and
# stopped every session workspace. Move teardown to a durable will-quit barrier.
quit_start = main.find("app.on('before-quit', () => {")
activate_marker = "\n\napp.on('activate',"
if quit_start != -1:
    quit_end = main.find(activate_marker, quit_start)
    if quit_end == -1:
        raise RuntimeError('Could not locate activate hook after before-quit')
    durable = r'''app.on('before-quit', () => {
  appIsQuitting = true
  logAssistantBridge('app-before-quit')
  stopUpdateChecks()
})

app.on('will-quit', createDurableQuitHandler({
  prepare: async () => {
    appIsQuitting = true
    await shutdownCollaboration()
  },
  dispose: async () => {
    logAssistantBridge('app-will-quit')
    orgDevAppArtifactService.dispose()
    devAppPreviewService.dispose()
    devAppWorkerHost.dispose()
    publishedDevAppWorkerHost.dispose()
    await disposeContainedDevAppRuntime()
    PreviewSnapshotService.getInstance().dispose()
    LocalAutomationResolverService.getInstance().dispose()
    await disposeWorkspaceCatalogRuntime()
    await stopSubstrateShadowServer()
    unregisterBrowserSurfaceHandlers?.()
    unregisterBrowserSurfaceHandlers = null
    if (t3BrowserSurfaceService) {
      await t3BrowserSurfaceService.dispose()
      t3BrowserSurfaceService = null
    }
  },
  quit: () => app.quit(),
  failed: (stage) => {
    console.error(`[Collaboration] Durable quit blocked during ${stage}; retry quit after recovery is saved.`)
  },
}))'''
    main = main[:quit_start] + durable + main[quit_end:]
main_path.write_text(main)

print("PR141 current-main compatibility, desktop activation, and authority fixes applied")

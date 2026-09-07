#!/usr/bin/env python3
from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise RuntimeError(f"{label}: anchor missing")
    return text.replace(old, new, 1)


# Git needs exact bounded bytes for blob reads used by the generation-3 runtime.
git_path = "apps/desktop/electron/gitRuntime.ts"
git = read(git_path)
if "stdoutBytes?: Uint8Array" not in git:
    git = git.replace("  stdout: string\n  stderr: string\n", "  stdout: string\n  stdoutBytes?: Uint8Array\n  stderr: string\n", 1)
if "captureStdoutBytes?: boolean" not in git:
    git = git.replace(
        "    stdin?: string\n    timeoutMs?: number\n  }\n): Promise<GitCommandResult> {",
        "    stdin?: string\n    timeoutMs?: number\n    captureStdoutBytes?: boolean\n    maxOutputBytes?: number\n  }\n): Promise<GitCommandResult> {",
        1,
    )
if "const stdoutChunks: Buffer[]" not in git:
    git = git.replace(
        '    let stdout = ""\n    let stderr = ""\n    let timedOut = false\n',
        '    let stdout = ""\n    const stdoutChunks: Buffer[] = []\n    let stdoutByteLength = 0\n    let outputTooLarge = false\n    let stderr = ""\n    let timedOut = false\n',
        1,
    )
    git = git.replace(
        '    child.stdout.on("data", (chunk: Buffer | string) => {\n      stdout += chunk.toString()\n    })\n',
        '''    child.stdout.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (options?.captureStdoutBytes) {
        stdoutByteLength += buffer.length
        const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024 * 1024
        if (stdoutByteLength > maxOutputBytes) {
          outputTooLarge = true
          try { child.kill("SIGKILL") } catch { /* best effort */ }
          return
        }
        stdoutChunks.push(buffer)
        return
      }
      stdout += buffer.toString()
    })
''',
        1,
    )
    git = git.replace(
        '''        success: !timedOut && code === 0,
        exitCode: code,
        stdout,
        stderr,
''',
        '''        success: !timedOut && !outputTooLarge && code === 0,
        exitCode: code,
        stdout,
        stdoutBytes: options?.captureStdoutBytes && !outputTooLarge
          ? new Uint8Array(Buffer.concat(stdoutChunks))
          : undefined,
        stderr,
''',
        1,
    )
    git = git.replace(
        '        error: timedOut ? "Git command timed out" : undefined,\n',
        '''        error: timedOut
          ? "Git command timed out"
          : outputTooLarge
            ? "Git command output exceeded the collaboration limit"
            : undefined,
''',
        1,
    )
write(git_path, git)

# Adapt the session workspace coordinator to the canonical nested repository credential.
coord_path = "apps/desktop/electron/collaboration/SessionWorkspaceCoordinator.ts"
coord = read(coord_path)
if 'CollaborationRepositoryCredentialResponse' not in coord:
    coord = coord.replace(
        'import { assertSharedFilePath } from "../../../../shared/collaborationPaths"\n',
        'import { assertSharedFilePath } from "../../../../shared/collaborationPaths"\nimport type { CollaborationRepositoryCredentialResponse } from "../../../../shared/collaborationRepository"\n',
        1,
    )
coord = re.sub(
    r'credential\(projectId: string, sessionId: string, operation: "read" \| "write", accessToken: string\): Promise<\{ cloneUrl: string; token: string; expiresAt: number; repositoryId: string \}>',
    'credential(projectId: string, sessionId: string, operation: "read" | "write", accessToken: string): Promise<CollaborationRepositoryCredentialResponse>',
    coord,
)
coord = coord.replace(
    '''    if (credential.expiresAt <= this.now() || credential.repositoryId !== authority.session.repositoryId ||
      canonicalRepository(credential.cloneUrl) !== canonicalRepository(authority.cloneUrl)) {
      throw new Error("Repository credentials expired or repository identity changed")
    }
''',
    '''    if (
      credential.expiresAt <= this.now() ||
      credential.operation !== operation ||
      credential.username !== "x-access-token" ||
      credential.repository.repositoryId !== authority.session.repositoryId ||
      canonicalRepository(credential.repository.cloneUrl) !== canonicalRepository(authority.cloneUrl)
    ) {
      throw new Error("Repository credentials expired or repository identity changed")
    }
''',
    1,
)
write(coord_path, coord)

handlers_path = "apps/desktop/electron/collaboration/registerCollaborationHandlers.ts"
handlers = read(handlers_path)
handlers = handlers.replace(
    '''    git: async (args, options) => {
      if (options.signal?.aborted) throw new Error("Collaboration Git operation cancelled")
      const result = await runGitCommand(args, { cwd: options.cwd, env: options.env, timeoutMs: 120_000 })
      if (options.signal?.aborted) throw new Error("Collaboration Git operation cancelled")
      return result
    },
''',
    '''    git: async (args, options) => {
      return await runGitCommand(args, {
        cwd: options.cwd,
        env: options.env,
        stdin: options.stdin,
        timeoutMs: 120_000,
        captureStdoutBytes: options.captureStdoutBytes,
        maxOutputBytes: options.maxOutputBytes,
      })
    },
''',
    1,
)
write(handlers_path, handlers)

# Only the safe renderer surface crosses context isolation. Raw gateway tokens remain main-only.
desktop_path = "shared/collaborationDesktop.ts"
desktop = read(desktop_path)
if "export interface CollaborationRendererAPI" not in desktop:
    desktop += '''
export interface CollaborationRendererAPI {
  downloadRepository(input: { projectId: string; slug: string }): Promise<LocalWorkspaceDTO>
  cancelDownload(projectId: string): Promise<void>
  onDownloadProgress(listener: (progress: RepositoryDownloadProgress) => void): () => void
  runtime: CollaborationRuntimeAPI
  getBinding(sessionId: string): Promise<SessionWorkspaceBinding | null>
  bindingForWorkspace(workspaceId: string): Promise<SessionWorkspaceBinding | null>
  inspectImportableChanges(sourceWorkspaceId: string): Promise<CollaborationImportCandidate[]>
}
'''
write(desktop_path, desktop)

api_types_path = "shared/electronApiTypes.ts"
api_types = read(api_types_path)
if "collaboration: import('./collaborationDesktop').CollaborationRendererAPI" not in api_types:
    api_types = replace_once(
        api_types,
        "  collab: {\n",
        "  collaboration: import('./collaborationDesktop').CollaborationRendererAPI\n  collab: {\n",
        "ElectronAPI collaboration bridge",
    )
write(api_types_path, api_types)

# Register the application-scoped owner only after Electron is ready, and save recovery before catalog disposal.
main_path = "apps/desktop/electron/main.ts"
main = read(main_path)
if "registerCollaborationHandlers" not in main:
    main = main.replace(
        "import { registerYjsHandlers } from './ipc/registerYjsHandlers'\n",
        "import { registerYjsHandlers } from './ipc/registerYjsHandlers'\nimport { registerCollaborationHandlers } from './collaboration/registerCollaborationHandlers'\nimport { shutdownCollaboration } from './collaboration/CollaborationShutdown'\n",
        1,
    )
if "registerCollaborationHandlers(ipcMain, app.getPath('userData'))" not in main:
    main = replace_once(
        main,
        "  registerWorkspaceHandlers(ipcMain, { loadSettings, saveSettings })\n",
        "  registerWorkspaceHandlers(ipcMain, { loadSettings, saveSettings })\n  registerCollaborationHandlers(ipcMain, app.getPath('userData'))\n",
        "main collaboration registration",
    )
if "let collaborationShutdownReady = false" not in main:
    main = replace_once(
        main,
        "app.on('before-quit', () => {\n",
        '''let collaborationShutdownReady = false
let collaborationShutdownPromise: Promise<void> | null = null

app.on('before-quit', (event) => {
  if (!collaborationShutdownReady) {
    event.preventDefault()
    if (!collaborationShutdownPromise) {
      collaborationShutdownPromise = shutdownCollaboration()
        .catch((error) => {
          console.error('[Collaboration] Failed to persist session recovery before quit', error)
        })
        .then(async () => {
          await disposeWorkspaceCatalogRuntime()
        })
        .finally(() => {
          collaborationShutdownReady = true
          app.quit()
        })
    }
    return
  }
''',
        "collaboration quit fence",
    )
    main = main.replace("  void disposeWorkspaceCatalogRuntime()\n", "", 1)
write(main_path, main)

# Complete the typed preload bridge.
preload_path = "apps/desktop/electron/preload.ts"
preload = read(preload_path)
if "CollaborationRendererAPI" not in preload:
    preload = preload.replace(
        "import type { WorkspaceCatalogSnapshot } from '../../../shared/workspaceTypes'\n",
        "import type { WorkspaceCatalogSnapshot } from '../../../shared/workspaceTypes'\nimport type { CollaborationRendererAPI } from '../../../shared/collaborationDesktop'\n",
        1,
    )
if "const collaborationRuntimeBridge" not in preload:
    bridge = '''
const collaborationRuntimeBridge: CollaborationRendererAPI['runtime'] = {
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
}

const collaborationBridge: CollaborationRendererAPI = {
  downloadRepository: (input) => ipcRenderer.invoke('collaboration:downloadRepository', input),
  cancelDownload: (projectId) => ipcRenderer.invoke('collaboration:cancelDownload', projectId),
  onDownloadProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => {
      listener(progress as Parameters<typeof listener>[0])
    }
    ipcRenderer.on('collaboration:downloadProgress', handler)
    return () => ipcRenderer.removeListener('collaboration:downloadProgress', handler)
  },
  runtime: collaborationRuntimeBridge,
  getBinding: (sessionId) => ipcRenderer.invoke('collaboration:getBinding', sessionId),
  bindingForWorkspace: (workspaceId) => ipcRenderer.invoke('collaboration:bindingForWorkspace', workspaceId),
  inspectImportableChanges: (sourceWorkspaceId) => ipcRenderer.invoke('collaboration:inspectImport', sourceWorkspaceId),
}

'''
    preload = replace_once(preload, "const previewBridge: CozeaDesktopPreviewBridge = {", bridge + "const previewBridge: CozeaDesktopPreviewBridge = {", "preload collaboration bridge")
if "  collaboration: collaborationBridge,\n" not in preload:
    preload = replace_once(preload, "  integrations: {\n", "  collaboration: collaborationBridge,\n  integrations: {\n", "preload exposed collaboration API")
write(preload_path, preload)

print("PR141 core activation transform applied")

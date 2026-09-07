#!/usr/bin/env python3
from pathlib import Path

path = Path("apps/desktop/electron/collaboration/registerCollaborationHandlers.ts")
text = path.read_text()

# Canonical repository credentials are atomic; there is no separate binding lookup.
text = text.replace(
'''  const downloader = new AuthorizedRepositoryDownloader({
    binding: projectId => gateway.post("/collab/v2/control", { operation: "repository.getBinding", args: { projectId } }),
    credential: projectId => gateway.post("/collab/repository/credential", { projectId, operation: "read" }),
''',
'''  const downloader = new AuthorizedRepositoryDownloader({
    credential: projectId => gateway.post("/collab/repository/credential", { projectId, operation: "read" }),
''',
)

# Current gitRuntime intentionally owns process environment and timeout policy but
# does not yet accept AbortSignal/max-output options. Preserve cooperative cancel
# checks at the collaboration layer rather than passing unsupported fields.
text = text.replace(
'''    git: (args, options) => runGitCommand(args, { ...options, timeoutMs: 300_000, maxOutputBytes: 4 * 1024 * 1024 }),
''',
'''    git: async (args, options) => {
      if (options.signal.aborted) throw new Error("Repository download cancelled")
      const result = await runGitCommand(args, { cwd: options.cwd, env: options.env, timeoutMs: 300_000 })
      if (options.signal.aborted) throw new Error("Repository download cancelled")
      return result
    },
''',
)
text = text.replace(
'''    git: (args, options) => runGitCommand(args, { ...options, timeoutMs: 120_000 }),
''',
'''    git: async (args, options) => {
      if (options.signal?.aborted) throw new Error("Collaboration Git operation cancelled")
      const result = await runGitCommand(args, { cwd: options.cwd, env: options.env, timeoutMs: 120_000 })
      if (options.signal?.aborted) throw new Error("Collaboration Git operation cancelled")
      return result
    },
''',
)

old_shutdown = '''    const results = await Promise.allSettled([
      stopNativeWorkspaceRoot(workspace.projectRootPath),
      WorkbenchSessionManager.getInstance().closeWorkspace(workspaceId),
    ])
    if (results.some(result => result.status === "rejected")) throw new Error("Session workspace shutdown was not fully acknowledged; retry Leave")
'''
new_shutdown = '''    const manager = WorkbenchSessionManager.getInstance()
    const workspaceSessions = manager.listSessions().filter(session => session.workspaceId === workspaceId)
    const results = await Promise.allSettled([
      stopNativeWorkspaceRoot(workspace.projectRootPath),
      ...workspaceSessions.map(session => manager.closeSession({
        sessionKey: session.sessionKey,
        projectId: session.projectId,
        laneId: session.laneId,
        workspaceId: session.workspaceId,
      })),
    ])
    if (results.some(result => result.status === "rejected")) throw new Error("Session workspace shutdown was not fully acknowledged; retry Leave")
'''
if old_shutdown in text:
    text = text.replace(old_shutdown, new_shutdown, 1)
elif "workspaceSessions = manager.listSessions()" not in text:
    raise SystemExit("Workbench session shutdown anchor missing")

path.write_text(text)
print("PR141 phase 8 current Electron substrate adaptation applied")

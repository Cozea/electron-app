#!/usr/bin/env bun
import {
  getProjectdSocketPath,
  ProjectdClient,
  type ProjectdCheckpointSummary,
} from "@cozea/projectd-protocol"

function describeCheckpoint(checkpoint: ProjectdCheckpointSummary): string {
  const at = new Date(checkpoint.publishedAt).toLocaleTimeString()
  return `${checkpoint.commitOid.slice(0, 8)} at sequence ${checkpoint.sessionSeq}, ${at}`
}

async function run(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0] ?? "health"

  let socketPath: string | undefined
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--socket" && args[i + 1]) {
      socketPath = args[i + 1]
    }
    if (args[i] === "--json") {
      jsonOutput = true
    }
  }

  const client = new ProjectdClient({
    socketPath: socketPath ?? getProjectdSocketPath(),
    clientName: "cozea-projectctl",
  })

  try {
    switch (command) {
      case "health": {
        const health = await client.health()
        if (jsonOutput) {
          console.log(JSON.stringify(health, null, 2))
        } else {
          console.log("cozea-projectd status:")
          console.log(`  Status:             ${health.status}`)
          console.log(`  Version:            ${health.version}`)
          console.log(`  Protocol:           ${health.protocolVersion}`)
          console.log(`  PID:                ${health.pid}`)
          console.log(`  Uptime:             ${health.uptimeSeconds}s`)
          console.log(`  Active Connections: ${health.activeConnections}`)
          console.log(`  Socket:             ${client.socketPath}`)
        }
        break
      }
      case "shutdown": {
        const res = await client.shutdown("Shutdown requested by cozea-projectctl")
        if (jsonOutput) {
          console.log(JSON.stringify(res, null, 2))
        } else {
          console.log("cozea-projectd is shutting down.")
        }
        break
      }
      case "echo": {
        const text = args.slice(1).filter((a) => !a.startsWith("--")).join(" ")
        const res = await client.request("echo", { text })
        if (jsonOutput) {
          console.log(JSON.stringify(res, null, 2))
        } else {
          console.log("Echo response:", res)
        }
        break
      }
      case "workbenches": {
        const projectId = args.find((a, idx) => idx > 0 && !a.startsWith("--"))
        if (!projectId) {
          console.error("Usage: cozea-projectctl workbenches <projectId>")
          process.exit(1)
        }
        const workbenches = await client.listWorkbenches(projectId)
        if (jsonOutput) {
          console.log(JSON.stringify(workbenches, null, 2))
        } else {
          console.log(`Workbenches for project '${projectId}':`)
          for (const wb of workbenches) {
            console.log(
              `  [${wb.lifecycle}] ${wb.workbenchId} - "${wb.title}" (${wb.kind}, workspace: ${wb.workspaceId})`,
            )
          }
        }
        break
      }
      case "workbench": {
        const sub = args[1]
        if (sub === "activate") {
          const projectId = args[2]
          const workbenchId = args[3]
          if (!projectId || !workbenchId) {
            console.error("Usage: cozea-projectctl workbench activate <projectId> <workbenchId>")
            process.exit(1)
          }
          const res = await client.activateWorkbench(projectId, workbenchId)
          if (jsonOutput) {
            console.log(JSON.stringify(res, null, 2))
          } else {
            console.log(`Activated workbench '${res.activated.workbenchId}'`)
            if (res.idled) {
              console.log(`Idled workbench '${res.idled.workbenchId}'`)
            }
          }
        } else {
          console.error("Usage: cozea-projectctl workbench activate <projectId> <workbenchId>")
          process.exit(1)
        }
        break
      }
      case "workspaces": {
        const projectId = args.find((a, idx) => idx > 0 && !a.startsWith("--"))
        if (!projectId) {
          console.error("Usage: cozea-projectctl workspaces <projectId>")
          process.exit(1)
        }
        const workspaces = await client.listWorkspaces(projectId)
        if (jsonOutput) {
          console.log(JSON.stringify(workspaces, null, 2))
        } else {
          console.log(`Workspaces for project '${projectId}':`)
          for (const ws of workspaces) {
            console.log(
              `  ${ws.workspaceId} - ${ws.rootPath} (${ws.storageOwnership}, active: ${ws.isActive})`,
            )
          }
        }
        break
      }
      case "sessions": {
        const sub = args[1] && !args[1].startsWith("--") ? args[1] : "list"
        if (sub === "save") {
          const publicSessionId = args[2]
          if (!publicSessionId || publicSessionId.startsWith("--")) {
            console.error("Usage: cozea-projectctl sessions save <publicSessionId>")
            process.exit(1)
          }
          const res = await client.checkpointSession(publicSessionId)
          if (jsonOutput) {
            console.log(JSON.stringify(res, null, 2))
          } else {
            console.log(`Save now: ${res.outcome}`)
            if (res.lastCheckpoint) console.log(`  Last checkpoint: ${describeCheckpoint(res.lastCheckpoint)}`)
          }
          break
        }
        if (sub !== "list") {
          console.error("Usage: cozea-projectctl sessions [list | save <publicSessionId>]")
          process.exit(1)
        }
        const sessions = await client.listSessions()
        if (jsonOutput) {
          console.log(JSON.stringify(sessions, null, 2))
          break
        }
        if (sessions.length === 0) {
          console.log("No live sessions.")
          break
        }
        for (const session of sessions) {
          const paused = session.pausedReason ? ` (${session.pausedReason})` : ""
          console.log(`Session ${session.publicSessionId}: ${session.state}${paused}`)
          console.log(`  Folder:   ${session.rootPath}`)
          console.log(`  Role:     ${session.role}`)
          console.log(
            `  Files:    ${session.fileCount} synced, ${session.skippedPaths.length} kept on this Mac, ${session.pendingBatches} batches waiting`,
          )
          console.log(`  Sequence: ${session.lastAppliedSessionSeq}`)
          if (session.lastError) console.log(`  Error:    ${session.lastError.code}: ${session.lastError.message}`)
          const autoGit = session.autoGit
          if (autoGit) {
            const saving = autoGit.saving ? ", saving" : ""
            console.log(`  AutoGit:  ${autoGit.state}${saving}, ${autoGit.unsavedChanges} unsaved changes`)
            console.log(
              `            last checkpoint ${autoGit.lastCheckpoint ? describeCheckpoint(autoGit.lastCheckpoint) : "none yet"}`,
            )
            if (autoGit.detail) console.log(`            ${autoGit.detail}`)
            if (autoGit.lastError) console.log(`            ${autoGit.lastError.code}: ${autoGit.lastError.message}`)
          }
        }
        break
      }
      case "help":
      case "--help":
      case "-h": {
        console.log(`Usage: cozea-projectctl [command] [options]

Commands:
  health                                      Check daemon health and connection status (default)
  shutdown                                    Gracefully shut down cozea-projectd
  workbenches <projectId>                     List workbenches for a project
  workbench activate <projectId> <wbId>       Activate a workbench for a project
  workspaces <projectId>                      List workspaces for a project
  sessions                                    List live sessions with sync and AutoGit state
  sessions save <publicSessionId>             Save a live session to Git now
  echo <text>                                 Send echo request to projectd
  help                                        Show this help message

Options:
  --socket <path>  Specify custom Unix domain socket path
  --json           Output results as JSON
`)
        break
      }
      default: {
        console.error(`Unknown command: '${command}'. Run 'cozea-projectctl help' for usage.`)
        process.exit(1)
      }
    }
  } catch (err: any) {
    if (jsonOutput) {
      console.error(JSON.stringify({ error: err.message, code: err.code }))
    } else {
      console.error(`cozea-projectctl error: ${err.message}`)
    }
    process.exit(1)
  } finally {
    client.disconnect()
  }
}

void run()


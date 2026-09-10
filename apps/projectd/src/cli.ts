#!/usr/bin/env bun
import {
  getProjectdSocketPath,
  ProjectdClient,
  type ProjectdHealthResult,
} from "@cozea/projectd-protocol"

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
      case "help":
      case "--help":
      case "-h": {
        console.log(`Usage: cozea-projectctl [command] [options]

Commands:
  health       Check daemon health and connection status (default)
  shutdown     Gracefully shut down cozea-projectd
  echo <text>  Send echo request to projectd
  help         Show this help message

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


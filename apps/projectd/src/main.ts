#!/usr/bin/env bun
import { getProjectdSocketPath } from "@cozea/projectd-protocol"
import { ProjectdServer } from "./server/ProjectdServer"

async function main(): Promise<void> {
  const socketPath = getProjectdSocketPath()
  const server = new ProjectdServer({ socketPath })

  console.log(`[projectd] Starting cozea-projectd on ${socketPath} (pid: ${process.pid})`)

  const shutdown = async (signal: string) => {
    console.log(`[projectd] Received ${signal}, shutting down gracefully...`)
    await server.stop()
    process.exit(0)
  }

  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))

  try {
    await server.start()
    console.log(`[projectd] Ready and listening on ${socketPath}`)
  } catch (err) {
    console.error("[projectd] Failed to start:", err)
    process.exit(1)
  }
}

void main()


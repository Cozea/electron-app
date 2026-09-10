/**
 * Manages the connection lifecycle of ProjectdClient in Electron Main.
 *
 * Master Specification: docs/collaboration/collaboration-autogit-master-plan.md
 * Phase: P02
 *
 * Invariant: Electron is a client and does NOT own the daemon process lifecycle.
 * If projectd is not running, Electron logs diagnostic information and stays disconnected.
 */

import { getSharedProjectdClient, resetSharedProjectdClient } from "./ProjectdClient"

export async function initProjectdService(): Promise<void> {
  const client = getSharedProjectdClient()
  try {
    await client.connect()
    const health = await client.health()
    console.log(
      `[Electron] Connected to cozea-projectd on ${client.socketPath} (version: ${health.version}, pid: ${health.pid})`,
    )
  } catch (err: any) {
    // Non-blocking: projectd is a standalone daemon. If not running, Electron continues gracefully.
    console.log(`[Electron] cozea-projectd is not currently reachable (${err?.message})`)
  }
}

export function disposeProjectdService(): void {
  resetSharedProjectdClient()
}

/**
 * Projectd client bridge in Electron Main.
 *
 * Master Specification: docs/collaboration/collaboration-autogit-master-plan.md
 * Phase: P02
 *
 * Requirements:
 * - Electron is a client of cozea-projectd (Section 8.1).
 * - Electron connects through ProjectdClient without owning daemon lifecycle.
 * - Checkpoint P02-C: Electron can connect/disconnect gracefully.
 */

import {
  getProjectdSocketPath,
  ProjectdClient,
  type ProjectdClientOptions,
} from "@cozea/projectd-protocol"

export { ProjectdClient } from "@cozea/projectd-protocol"

let sharedClient: ProjectdClient | null = null

export function getSharedProjectdClient(options?: ProjectdClientOptions): ProjectdClient {
  if (!sharedClient) {
    sharedClient = new ProjectdClient({
      socketPath: options?.socketPath ?? getProjectdSocketPath(),
      clientName: "cozea-desktop-electron",
      ...options,
    })
  }
  return sharedClient
}

export function resetSharedProjectdClient(): void {
  if (sharedClient) {
    sharedClient.disconnect()
    sharedClient = null
  }
}

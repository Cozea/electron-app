/**
 * Renderer-local bus for asking a live agent tile to refresh project memory.
 *
 * The assistant runs over its own transport with no prompt-injection IPC, so a
 * request is handed to the mounted controller for the target tile, which owns
 * the composer and the send path. Mirrors the devServerTileCommands pattern.
 */

export interface MemoryUpdateRequest {
  /** The assistant tile that should run the update. */
  targetTileId: string
  /** Full instruction text; the controller sends it as a normal user turn. */
  prompt: string
  requestedAt: number
}

type MemoryUpdateHandler = (request: MemoryUpdateRequest) => void

const handlers = new Set<MemoryUpdateHandler>()

export function subscribeMemoryUpdateRequests(handler: MemoryUpdateHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

export function dispatchMemoryUpdateRequest(
  request: Omit<MemoryUpdateRequest, "requestedAt">,
): boolean {
  if (handlers.size === 0) return false
  const payload: MemoryUpdateRequest = { ...request, requestedAt: Date.now() }
  for (const handler of Array.from(handlers)) {
    try {
      handler(payload)
    } catch {
      // One controller throwing must not stop delivery to the addressed tile.
    }
  }
  return true
}

/**
 * The instruction sent to the agent. Deliberately names the skill rather than a
 * command so a project using a different memory skill still gets a sensible
 * turn; the agent resolves the skill it has.
 */
export function buildMemoryUpdatePrompt(skillLabel: string): string {
  return [
    `Update this project's memory map using the ${skillLabel} skill.`,
    "Re-extract the project so the graph reflects the current code, then reply with a one-paragraph summary of what changed.",
  ].join(" ")
}

/** First build: there is no graph to re-extract against, so ask for the map itself. */
export function buildMemoryBuildPrompt(skillLabel: string): string {
  return [
    `Build this project's memory map using the ${skillLabel} skill.`,
    "Walk the project, extract its symbols and relationships, cluster them, and write the graph so every agent here can navigate the codebase.",
  ].join(" ")
}

/**
 * The agent's answer back.
 *
 * A rebuild can fail for reasons the Memory tile cannot see by watching the
 * graph file — a usage limit, a runtime outage, a refused turn. Without this
 * the tile would spin for its full timeout waiting for a build that is never
 * coming, which is worse than saying so.
 */
export interface MemoryUpdateOutcome {
  targetTileId: string
  status: "failed"
  message: string
}

type MemoryOutcomeHandler = (outcome: MemoryUpdateOutcome) => void

const outcomeHandlers = new Set<MemoryOutcomeHandler>()

export function subscribeMemoryUpdateOutcomes(handler: MemoryOutcomeHandler): () => void {
  outcomeHandlers.add(handler)
  return () => {
    outcomeHandlers.delete(handler)
  }
}

export function reportMemoryUpdateOutcome(outcome: MemoryUpdateOutcome): void {
  for (const handler of Array.from(outcomeHandlers)) {
    try {
      handler(outcome)
    } catch {
      // One listener failing must not hide the outcome from the others.
    }
  }
}

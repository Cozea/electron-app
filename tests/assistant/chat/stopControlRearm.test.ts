import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Stopping a wedged run is a two stage control: the first press interrupts the
 * turn, and 2s later Force stop unlocks and tears the provider session down.
 * Force stop hides itself when it dispatches, so unless every press re-arms the
 * timer the button latches off with a spinner for the rest of the run, exactly
 * when the user most needs to escalate.
 */
const lifecycleSource = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/workbench/assistant/useAssistantTurnLifecycle.ts",
  ),
  "utf8",
)

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)

  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe("stop control re-arming", () => {
  it("arms the force stop timer off the attempt counter, not just the first press", () => {
    const armingEffect = sourceBetween(
      lifecycleSource,
      "setIsForceStopAvailable(false)\n    const timeoutId = window.setTimeout(",
      "const handleForceStop",
    )

    expect(armingEffect).toContain("FORCE_STOP_DELAY_MS")
    expect(armingEffect).toContain("stopAttempt")
  })

  it("counts both the interrupt press and the force stop press", () => {
    const forceStop = sourceBetween(
      lifecycleSource,
      "const handleForceStop = useCallback(",
      "const handleInterrupt = useCallback(",
    )
    const interrupt = sourceBetween(
      lifecycleSource,
      "const handleInterrupt = useCallback(",
      "return {",
    )

    expect(forceStop).toContain("setStopAttempt((current) => current + 1)")
    expect(forceStop).toContain('type: "thread.session.stop"')
    expect(interrupt).toContain("setStopAttempt((current) => current + 1)")
    expect(interrupt).toContain('type: "thread.turn.interrupt"')
  })
})

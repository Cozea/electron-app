export interface DurableQuitDependencies {
  prepare(): Promise<void>
  dispose(): Promise<void>
  quit(): void
  failed(stage: "prepare" | "dispose"): void
}

/** Install on Electron's will-quit, after every renderer has accepted unload.
 * Never dispose persistence/native owners during a cancelable before-quit. */
export function createDurableQuitHandler(deps: DurableQuitDependencies): (event: { preventDefault(): void }) => void {
  let prepared = false
  let complete = false
  let inFlight: Promise<void> | null = null
  return event => {
    if (complete) return
    event.preventDefault()
    if (inFlight) return
    inFlight = Promise.resolve().then(async () => {
      if (!prepared) {
        await deps.prepare()
        prepared = true
      }
      await deps.dispose()
      complete = true
      deps.quit()
    }).catch(() => {
      // Only a stage crosses into UI. Filesystem/provider diagnostics may
      // contain local paths or credentials and are not suitable dialog copy.
      try { deps.failed(prepared ? "dispose" : "prepare") } catch { /* Keep quit blocked even if the recovery window cannot be shown. */ }
    }).finally(() => { inFlight = null })
  }
}

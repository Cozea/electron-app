import * as Effect from "effect/Effect"
import type { LocalProjectCatalogInterface } from "./LocalProjectCatalog.ts"
import type { LocalProjectLifecycleInterface } from "./LocalProjectLifecycle.ts"

interface RecoveryDependencies {
  projects: LocalProjectCatalogInterface
  lifecycle: LocalProjectLifecycleInterface
  now?: () => number
  onError?: (operationId: string, error: string) => void
}

/** One bounded boot pass. Explicit repair/removal/network effects require UI recovery. */
export function reconcileLocalProjectOperations(deps: RecoveryDependencies) {
  return Effect.gen(function* () {
    const now = deps.now ?? Date.now
    const started = now()
    const operations = yield* deps.projects.listRecoverableOperations()
    let attempted = 0
    for (const operation of operations) {
      if (attempted >= 32 || now() - started >= 15_000) break
      if ((operation.kind !== "create" && operation.kind !== "attach") || operation.state === "failed") continue
      attempted += 1
      const result = yield* deps.lifecycle.resume(operation.operationId)
      if (!result.success) deps.onError?.(operation.operationId, result.error)
    }
    return attempted
  })
}

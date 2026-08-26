// @ts-nocheck
import { Effect, Layer } from "effect";
import { defaultInstanceIdForDriver } from "@cozea/assistant-contracts";

import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { AnalyticsService } from "../../telemetry/Services/AnalyticsService.ts";

const PROVIDER_SESSION_REAPER_INTERVAL = "10 minutes";
const PROVIDER_SESSION_IDLE_TTL_MS = 45 * 60 * 1000;
const PROVIDER_SESSION_BINDING_RETENTION_MS = 6 * 60 * 60 * 1000;

function ageMs(timestamp: string | null | undefined): number {
  if (!timestamp) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, Date.now() - parsed);
}

export const ProviderSessionReaperLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ProviderAdapterRegistry
    const directory = yield* ProviderSessionDirectory
    const analytics = yield* AnalyticsService

    const reapOnce = Effect.gen(function* () {
      const instanceIds = yield* registry.listInstances()
      const adapters = yield* Effect.forEach(instanceIds, (instanceId) =>
        registry.getByInstance(instanceId).pipe(
          Effect.map((adapter) => ({ instanceId, adapter })),
        ),
      )

      const bindings = yield* directory.listBindings().pipe(
        Effect.orElseSucceed(() => []),
      )
      for (const binding of bindings) {
        const bindingAge = ageMs(binding.lastSeenAt)
        if (
          (binding.status === "stopped" || binding.status === "error") &&
          bindingAge >= PROVIDER_SESSION_BINDING_RETENTION_MS
        ) {
          yield* directory.remove(binding.threadId).pipe(Effect.ignoreCause({ log: true }))
          yield* analytics.record("provider.session.binding.reaped", {
            provider: binding.provider,
            status: binding.status,
            ageMs: bindingAge,
          })
        }
      }

      const sessionsByAdapter = yield* Effect.forEach(
        adapters,
        ({ instanceId, adapter }) =>
          adapter.listSessions().pipe(
            Effect.map((sessions) => sessions.map((session) => ({ instanceId, adapter, session }))),
            Effect.orElseSucceed(() => []),
          ),
      )

      for (const { instanceId, adapter, session } of sessionsByAdapter.flatMap((entries) => entries)) {
        if (session.status === "running" || session.activeTurnId) {
          continue
        }
        const sessionAge = ageMs(session.updatedAt)
        if (sessionAge < PROVIDER_SESSION_IDLE_TTL_MS) {
          continue
        }

        yield* adapter.stopSession(session.threadId).pipe(Effect.ignoreCause({ log: true }))
        yield* directory.upsert({
          threadId: session.threadId,
          provider: adapter.provider,
          providerInstanceId:
            session.providerInstanceId ?? instanceId ?? defaultInstanceIdForDriver(adapter.provider),
          status: "stopped",
          runtimePayload: {
            activeTurnId: null,
            lastRuntimeEvent: "provider.sessionReaper",
            lastRuntimeEventAt: new Date().toISOString(),
            sessionUpdatedAt: new Date().toISOString(),
          },
        }).pipe(Effect.ignoreCause({ log: true }))
        yield* analytics.record("provider.session.reaped", {
          provider: adapter.provider,
          threadId: session.threadId,
          ageMs: sessionAge,
          sessionStatus: session.status,
        })
      }
    })

    yield* reapOnce.pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped)
    yield* Effect.forever(
      Effect.sleep(PROVIDER_SESSION_REAPER_INTERVAL).pipe(
        Effect.flatMap(() => reapOnce),
        Effect.ignoreCause({ log: true }),
      ),
    ).pipe(Effect.forkScoped)
  }),
)

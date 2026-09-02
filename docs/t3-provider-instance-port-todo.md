# T3 Provider Instance Port TODO

Scope: port the latest T3 Code provider-instance architecture and related
runtime routing stability into Cozea. Keep this checklist focused on AI
provider instances, provider runtime routing, model selection, and the UI needed
to configure/select them.

T3 reference checkout:

`<home>/Downloads/apps-we-study/t3code-latest-main`

## Current Progress

Verified on 2026-05-06:

- [x] Contracts now expose open `ProviderDriverKind`, separate `ProviderInstanceId`, provider instance config, and instance-aware model selections.
- [x] SQLite/runtime projections persist `provider_instance_id` for provider sessions and thread sessions.
- [x] Runtime provider materialization now uses a T3-style provider driver / provider instance registry.
- [x] Settings changes reconcile provider instances without tearing down unchanged instances.
- [x] Provider service start/recovery/reaper paths route by exact instance id.
- [x] Provider snapshots and status cache are keyed per instance.
- [x] Renderer model picker, sidebar, trigger, model rows, favorites, and workbench selections are instance-aware.
- [x] Git/text-generation flows route by `ProviderInstanceId`.
- [x] Per-instance environment variables are merged into CLI process env for provider session and text-generation spawn paths.
- [x] `bun run typecheck` passes.
- [x] `bun run typecheck:assistant-runtime` passes.

Still remaining:

- [ ] Add a full provider instance settings UI for add/edit/delete/disable, custom models, and env vars.
- [ ] Add focused tests for contracts, migrations, registry reconciliation, provider service routing/recovery, and UI helpers.
- [ ] Optionally make composer slash/model autocomplete instance-aware, not just the picker.

## Audit Correction

The stable runtime/session behavior from older T3 work is already present in
Cozea. Do not re-implement it. The remaining useful port is the newer
provider-instance architecture: separate driver kind from routable instance id,
then make Cozea's existing stable session recovery instance-aware.

Already present in Cozea:

- [x] Persist provider session runtime rows in SQLite.
- [x] Persist resume cursor/runtime payload for thread recovery.
- [x] Re-open a thread by adopting an active provider session when available.
- [x] Re-open a thread by resuming from persisted cursor when no active session exists.
- [x] Reuse persisted cwd/model selection when recovering a provider session.
- [x] Stop stale sessions for the same thread on other provider kinds.
- [x] Run a provider session reaper for idle sessions and old stopped/error bindings.
- [x] Coalesce ACP `start()` calls with a `NotStarted` / `Starting` / `Started` state machine.
- [x] For ACP resume, try `session/load` before falling back to `session/new`.
- [x] Avoid redundant Cursor ACP model/config option writes when the current value already matches.
- [x] Cache provider snapshots and retain usable metadata during transient provider health failures.

Port status:

- [x] T3's open `ProviderDriverKind` plus separate `ProviderInstanceId`.
- [x] Multiple configured instances for the same driver, e.g. `codex_personal` and `codex_work`.
- [x] Instance-scoped driver materialization, scopes, snapshots, adapters, and text generation.
- [x] Instance-aware persistence columns and recovery guards.
- [x] Instance-aware model selections, settings, favorites, and model picker UI.
- [ ] Unknown-driver / invalid-config preservation as unavailable provider snapshots. Unknown shadows are surfaced, but this still needs tests and polish.
- [x] Settings hot reload that rebuilds only changed provider instances.

## T3-First Rule

Before every edit:

- [ ] Re-open the matching T3 reference files.
- [ ] Re-open the matching Cozea target files.
- [ ] Compare the current shapes before deciding what to port.
- [ ] Port only what fits Cozea's local Electron assistant runtime.
- [ ] Preserve unrelated local changes in the Cozea worktree.

Default comparison commands:

```shell
rg -n "ProviderInstance|providerInstanceId|ProviderDriverKind|ModelSelection" <home>/Downloads/apps-we-study/t3code-latest-main/packages/contracts/src
rg -n "ProviderInstanceRegistry|ProviderDriver|providerInstanceId|resolveRoutableSession" <home>/Downloads/apps-we-study/t3code-latest-main/apps/server/src/provider
rg -n "deriveProviderInstanceEntries|ProviderModelPicker|ProviderInstanceCard" <home>/Downloads/apps-we-study/t3code-latest-main/apps/web/src
rg -n "ProviderKind|providerInstanceId|ModelSelection|startSession|sendTurn" shared electron src
```

## Phase 0: Baseline Audit

T3 references:

- [ ] `packages/contracts/src/providerInstance.ts`
- [ ] `packages/contracts/src/orchestration.ts`
- [ ] `packages/contracts/src/provider.ts`
- [ ] `packages/contracts/src/providerRuntime.ts`
- [ ] `packages/contracts/src/settings.ts`
- [ ] `packages/contracts/src/server.ts`
- [ ] `apps/server/src/provider/ProviderDriver.ts`
- [ ] `apps/server/src/provider/builtInDrivers.ts`
- [ ] `apps/server/src/provider/Layers/ProviderInstanceRegistryLive.ts`
- [ ] `apps/server/src/provider/Layers/ProviderService.ts`
- [ ] `apps/server/src/provider/Layers/ProviderSessionDirectory.ts`
- [ ] `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

Cozea targets:

- [ ] `shared/assistant-contracts/orchestration.ts`
- [ ] `shared/assistant-contracts/provider.ts`
- [ ] `shared/assistant-contracts/providerRuntime.ts`
- [ ] `shared/assistant-contracts/settings.ts`
- [ ] `shared/assistant-contracts/server.ts`
- [ ] `electron/assistant-runtime/provider/Layers/ProviderService.ts`
- [ ] `electron/assistant-runtime/provider/Layers/ProviderSessionDirectory.ts`
- [ ] `electron/assistant-runtime/provider/Layers/ProviderAdapterRegistry.ts`
- [ ] `electron/assistant-runtime/provider/Layers/ProviderRegistry.ts`
- [ ] `electron/assistant-runtime/orchestration/Layers/ProviderCommandReactor.ts`

Tasks:

- [x] Record which T3 runtime stability pieces Cozea already has.
- [x] Record which paths still route by closed `ProviderKind`.
- [x] Record which UI paths assume one model list per provider kind.
- [x] Confirm no implementation starts from stale assumptions.

## Phase 1: Contracts

T3 references:

- [ ] `packages/contracts/src/providerInstance.ts`
- [ ] `packages/contracts/src/orchestration.ts`
- [ ] `packages/contracts/src/provider.ts`
- [ ] `packages/contracts/src/providerRuntime.ts`
- [ ] `packages/contracts/src/settings.ts`
- [ ] `packages/contracts/src/server.ts`
- [ ] `packages/contracts/src/providerInstance.test.ts`
- [ ] `packages/contracts/src/orchestration.test.ts`
- [ ] `packages/contracts/src/settings.test.ts`

Cozea targets:

- [ ] `shared/assistant-contracts/providerInstance.ts` (new)
- [ ] `shared/assistant-contracts/index.ts`
- [ ] `shared/assistant-contracts/orchestration.ts`
- [ ] `shared/assistant-contracts/provider.ts`
- [ ] `shared/assistant-contracts/providerRuntime.ts`
- [ ] `shared/assistant-contracts/settings.ts`
- [ ] `shared/assistant-contracts/server.ts`
- [ ] `shared/assistant-contracts/model.ts`
- [ ] `shared/assistant-shared/model.ts`
- [ ] `shared/assistant-shared/serverSettings.ts`

Tasks:

- [x] Add `ProviderDriverKind` as an open branded slug.
- [x] Add `ProviderInstanceId` as a separate branded slug.
- [x] Add `ProviderInstanceRef`.
- [x] Add `ProviderInstanceEnvironmentVariable`.
- [x] Add `ProviderInstanceConfig`.
- [x] Add `ProviderInstanceConfigMap`.
- [x] Add `defaultInstanceIdForDriver(driver)`.
- [x] Keep legacy driver strings valid as default instance ids.
- [x] Change `ModelSelection` to `{ provider, instanceId, model, options }` during transition.
- [x] Decode legacy `{ provider, model, options }` into default instance ids.
- [x] Encode model selections with instance ids.
- [x] Add optional `providerInstanceId` to provider sessions.
- [x] Add optional `providerInstanceId` to provider runtime events.
- [x] Add optional `providerInstanceId` to orchestration thread sessions.
- [x] Add `providerInstances` to `ServerSettings`.
- [x] Keep legacy `settings.providers.*` during migration.
- [x] Change `textGenerationModelSelection` to include `instanceId`.
- [x] Key favorites by `ProviderInstanceId` in the renderer picker.
- [ ] Key provider model preferences by `ProviderInstanceId`.
- [x] Make display/model helpers safe for unknown open driver slugs.

Acceptance:

- [x] Old `{ provider: "codex" }` model selections decode.
- [x] New `{ instanceId: "codex_personal" }` model selections decode.
- [ ] Unknown driver envelopes decode and round-trip.
- [x] `bun run typecheck` has no new contract errors.

## Phase 2: Persistence

T3 references:

- [ ] `apps/server/src/persistence/Migrations/027_ProviderSessionRuntimeInstanceId.ts`
- [ ] `apps/server/src/persistence/Migrations/028_ProjectionThreadSessionInstanceId.ts`
- [ ] `apps/server/src/persistence/Layers/ProviderSessionRuntime.ts`
- [ ] `apps/server/src/persistence/Services/ProviderSessionRuntime.ts`

Cozea targets:

- [ ] `electron/assistant-runtime/persistence/Migrations.ts`
- [ ] `electron/assistant-runtime/persistence/Migrations/017_ProviderSessionRuntimeInstanceId.ts` (new)
- [ ] `electron/assistant-runtime/persistence/Migrations/018_ProjectionThreadSessionInstanceId.ts` (new)
- [ ] `electron/assistant-runtime/persistence/Services/ProviderSessionRuntime.ts`
- [ ] `electron/assistant-runtime/persistence/Layers/ProviderSessionRuntime.ts`
- [ ] `electron/assistant-runtime/persistence/Services/ProjectionThreadSessions.ts`
- [ ] `electron/assistant-runtime/persistence/Layers/ProjectionThreadSessions.ts`

Tasks:

- [x] Add `provider_instance_id` to `provider_session_runtime`.
- [x] Backfill `provider_session_runtime.provider_instance_id` from `provider_name`.
- [x] Add `provider_instance_id` to projection thread sessions.
- [x] Backfill projection session `provider_instance_id` from `provider_name`.
- [x] Update provider runtime repository schemas.
- [x] Update provider runtime repository reads/writes.
- [x] Update projection session repository schemas.
- [x] Update projection session repository reads/writes.
- [x] Register new migrations in `Migrations.ts`.

Acceptance:

- [x] Existing local DB rows migrate without manual cleanup.
- [x] Old persisted sessions route to default instance ids.
- [x] New persisted sessions always include `providerInstanceId`.

## Phase 3: Provider Driver And Instance Registry

T3 references:

- [ ] `apps/server/src/provider/ProviderDriver.ts`
- [ ] `apps/server/src/provider/builtInDrivers.ts`
- [ ] `apps/server/src/provider/Layers/ProviderInstanceRegistryLive.ts`
- [ ] `apps/server/src/provider/Services/ProviderInstanceRegistry.ts`
- [ ] `apps/server/src/provider/Services/ProviderInstanceRegistryMutator.ts`
- [ ] `apps/server/src/provider/unavailableProviderSnapshot.ts`
- [ ] `apps/server/src/provider/ProviderInstanceEnvironment.ts`

Cozea targets:

- [ ] `electron/assistant-runtime/provider/ProviderDriver.ts` (new)
- [ ] `electron/assistant-runtime/provider/builtInDrivers.ts` (new)
- [ ] `electron/assistant-runtime/provider/Layers/ProviderInstanceRegistry.ts` (new)
- [ ] `electron/assistant-runtime/provider/Services/ProviderInstanceRegistry.ts` (new)
- [ ] `electron/assistant-runtime/provider/Services/ProviderInstanceRegistryMutator.ts` (new)
- [ ] `electron/assistant-runtime/provider/unavailableProviderSnapshot.ts` (new)
- [ ] `electron/assistant-runtime/provider/ProviderInstanceEnvironment.ts` (new)
- [ ] `electron/assistant-runtime/provider/builtInProviderCatalog.ts`
- [ ] `electron/assistant-runtime/provider/Layers/ProviderRegistry.ts`
- [ ] `electron/assistant-runtime/provider/Layers/ProviderAdapterRegistry.ts`
- [ ] `electron/assistant-runtime/serverLayers.ts`

Tasks:

- [ ] Add plain-value `ProviderDriver` SPI.
- [ ] Add `ProviderInstance` with `snapshot`, `adapter`, and `textGeneration`.
- [ ] Create Codex driver.
- [ ] Create Claude driver.
- [ ] Create Cursor driver.
- [ ] Create OpenCode driver.
- [ ] Give each driver a typed config schema.
- [ ] Give each driver a default config.
- [ ] Build default instances from legacy `settings.providers.*`.
- [ ] Build explicit instances from `settings.providerInstances`.
- [ ] Preserve unknown drivers as unavailable snapshots.
- [ ] Preserve invalid configs as unavailable snapshots.
- [ ] Reconcile settings by closing only removed/replaced instance scopes.
- [ ] Keep unchanged instance scopes alive.
- [ ] Stream instance-registry changes.
- [x] Merge per-instance env vars into CLI process env.

Acceptance:

- [ ] Two instances of the same driver can be materialized.
- [ ] Updating one instance does not restart other unchanged instances.
- [ ] Unknown instances surface as unavailable, not fatal errors.

## Phase 4: ProviderService Routing

T3 references:

- [ ] `apps/server/src/provider/Layers/ProviderService.ts`
- [ ] `apps/server/src/provider/Layers/ProviderSessionDirectory.ts`
- [ ] `apps/server/src/provider/Layers/ProviderSessionReaper.ts`

Cozea targets:

- [ ] `electron/assistant-runtime/provider/Layers/ProviderService.ts`
- [ ] `electron/assistant-runtime/provider/Layers/ProviderSessionDirectory.ts`
- [ ] `electron/assistant-runtime/provider/Layers/ProviderSessionReaper.ts`
- [ ] `electron/assistant-runtime/provider/Services/ProviderService.ts`
- [ ] `electron/assistant-runtime/provider/Services/ProviderSessionDirectory.ts`

Tasks:

- [ ] Route `startSession` by `ProviderInstanceId`.
- [ ] Validate optional legacy `provider` against the instance's driver.
- [ ] Persist `providerInstanceId` in session bindings.
- [ ] Recover sessions by exact instance id.
- [ ] Adopt in-memory sessions only from the matching instance.
- [ ] Resume with persisted cursor only when persisted instance matches.
- [ ] Resume with persisted cwd only when persisted instance matches.
- [ ] Resume with persisted model selection only when persisted instance matches.
- [ ] Stop stale sessions for the same thread on other instances.
- [ ] Stamp `providerInstanceId` in `listSessions`.
- [ ] Validate active sessions against persisted bindings.
- [ ] Change `getCapabilities` to accept `ProviderInstanceId`.
- [ ] Correlate runtime events with source instance.
- [ ] Log driver and instance id in lifecycle events.

Acceptance:

- [ ] Opening a thread cannot silently bind it to a different instance.
- [ ] Sending a turn after UI reopen adopts an active matching session.
- [ ] Sending a turn after app restart resumes from persisted matching state.
- [ ] Switching instance stops stale sessions for that thread.

## Phase 5: Instance-Bound Adapters

T3 references:

- [ ] `apps/server/src/provider/Layers/CodexAdapter.ts`
- [ ] `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- [ ] `apps/server/src/provider/Layers/CursorAdapter.ts`
- [ ] `apps/server/src/provider/Layers/OpenCodeAdapter.ts`
- [ ] `apps/server/src/provider/acp/AcpSessionRuntime.ts`
- [ ] `apps/server/src/provider/acp/CursorAcpSupport.ts`
- [ ] `apps/server/src/provider/opencodeRuntime.ts`

Cozea targets:

- [ ] `electron/assistant-runtime/provider/Layers/CodexAdapter.ts`
- [ ] `electron/assistant-runtime/provider/Layers/ClaudeAdapter.ts`
- [ ] `electron/assistant-runtime/provider/Layers/CursorAdapter.ts`
- [ ] `electron/assistant-runtime/provider/Layers/OpenCodeAdapter.ts`
- [ ] `electron/assistant-runtime/provider/acp/AcpSessionRuntime.ts`
- [ ] `electron/assistant-runtime/provider/acp/CursorAcpSupport.ts`
- [ ] `electron/assistant-runtime/provider/opencodeRuntime.ts`
- [ ] `electron/assistant-runtime/codexAppServerManager.ts`

Tasks:

- [ ] Add `instanceId` construction options to each adapter.
- [ ] Pass typed settings into each adapter from its driver.
- [ ] Stop reading global provider settings inside adapters.
- [ ] Replace `modelSelection.provider` checks with `modelSelection.instanceId`.
- [ ] Stamp `providerInstanceId` on returned sessions.
- [ ] Stamp `providerInstanceId` on emitted events where needed.
- [ ] Make Codex home/shadow home path instance-scoped.
- [ ] Make Claude home path and launch args instance-scoped.
- [ ] Make Cursor binary/API endpoint/env instance-scoped.
- [ ] Make OpenCode binary/server URL/password/env instance-scoped.
- [ ] Preserve per-thread session maps inside each instance adapter.
- [ ] Preserve Cursor ACP start-state guard.
- [ ] Preserve Cursor per-thread semaphore behavior.
- [ ] Preserve OpenCode concurrent `startSession` race guard.
- [ ] Review finalizers for per-instance scope cleanup.

Acceptance:

- [ ] Two same-driver instances do not share mutable adapter state.
- [ ] In-session model switching still works where supported.
- [ ] Unsupported model switching restarts only the current thread/instance.
- [ ] Cursor ACP does not duplicate initialize/auth/session-new on concurrent starts.

## Phase 6: Orchestration Binding

T3 references:

- [ ] `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- [ ] `apps/server/src/orchestration/decider.ts`
- [ ] `apps/server/src/orchestration/projector.ts`
- [ ] `packages/contracts/src/orchestration.ts`

Cozea targets:

- [ ] `electron/assistant-runtime/orchestration/Layers/ProviderCommandReactor.ts`
- [ ] `electron/assistant-runtime/orchestration/decider.ts`
- [ ] `electron/assistant-runtime/orchestration/projector.ts`
- [ ] `electron/assistant-runtime/orchestration/sessionStatus.ts`
- [ ] `electron/assistant-runtime/persistence/Layers/ProjectionPipeline.ts`
- [ ] `electron/assistant-runtime/orchestration/Layers/ProjectionSnapshotQuery.ts`
- [ ] `src/stores/orchestrationReadModelProjector.ts`
- [ ] `src/stores/assistant-store.ts`

Tasks:

- [ ] Store thread model selections as instance-based selections.
- [ ] Store thread sessions with `providerInstanceId`.
- [ ] Prevent thread turns from switching instances unless requested.
- [ ] Detect `instanceChanged` separately from `modelChanged`.
- [ ] Restart session when instance changes.
- [ ] Preserve resume cursor unless restart reason makes it unsafe.
- [ ] Query capabilities by instance id.
- [ ] Keep provider driver for display/icon behavior only.
- [ ] Ensure first-turn session start uses selected instance.
- [ ] Ensure resumed/pending turns use cached instance model selection.
- [ ] Replace provider-name routing checks with instance-aware helpers.

Acceptance:

- [ ] A thread created with `codex_personal` keeps using `codex_personal`.
- [ ] Model-only changes do not restart providers with in-session switching.
- [ ] Instance switches restart exactly once and persist the new binding.

## Phase 7: Provider Snapshots And Server Config

T3 references:

- [ ] `packages/contracts/src/server.ts`
- [ ] `apps/server/src/provider/providerSnapshot.ts`
- [ ] `apps/server/src/provider/makeManagedServerProvider.ts`
- [ ] `apps/server/src/provider/providerStatusCache.ts`
- [ ] `apps/server/src/provider/Drivers/*Driver.ts`

Cozea targets:

- [ ] `shared/assistant-contracts/server.ts`
- [ ] `electron/assistant-runtime/provider/providerSnapshot.ts`
- [ ] `electron/assistant-runtime/provider/makeManagedServerProvider.ts`
- [ ] `electron/assistant-runtime/provider/providerStatusCache.ts`
- [ ] `electron/assistant-runtime/provider/Layers/*Provider.ts`
- [ ] `src/stores/providerModels.ts`

Tasks:

- [ ] Add `instanceId` to `ServerProvider`.
- [ ] Add `driver` to `ServerProvider`.
- [ ] Add optional `displayName` to `ServerProvider`.
- [ ] Add optional `accentColor` to `ServerProvider`.
- [ ] Add availability/unavailable metadata.
- [ ] Include instance id in provider status cache keys.
- [ ] Retain last-known metadata per instance on transient refresh failures.
- [ ] Emit unavailable shadow snapshots in server config.
- [ ] Keep model capabilities attached across transient refresh failures.
- [ ] Update model helper functions for driver and instance ids.

Acceptance:

- [ ] Config emits one provider snapshot per configured instance.
- [ ] Two same-driver instances are visually distinguishable.
- [ ] One instance refresh failure does not poison another instance.

## Phase 8: Renderer UI

T3 references:

- [ ] `apps/web/src/providerInstances.ts`
- [ ] `apps/web/src/modelSelection.ts`
- [ ] `apps/web/src/components/chat/ProviderModelPicker.tsx`
- [ ] `apps/web/src/components/chat/ModelPickerContent.tsx`
- [ ] `apps/web/src/components/chat/ModelPickerSidebar.tsx`
- [ ] `apps/web/src/components/settings/AddProviderInstanceDialog.tsx`
- [ ] `apps/web/src/components/settings/ProviderInstanceCard.tsx`
- [ ] `apps/web/src/components/settings/ProviderModelsSection.tsx`
- [ ] `apps/web/src/components/settings/SettingsPanels.tsx`

Cozea targets:

- [ ] `src/features/projects/components/assistant/chat/ProviderModelPicker.tsx`
- [ ] `src/features/projects/components/assistant/chat/ModelPickerContent.tsx`
- [ ] `src/features/projects/components/assistant/chat/ModelPickerSidebar.tsx`
- [ ] `src/features/projects/components/assistant/chat/ModelListRow.tsx`
- [ ] `src/features/projects/components/assistant/chat/CozeaChatSurface.tsx`
- [ ] `src/features/projects/components/assistant/chat/composerDraftStore.ts`
- [ ] `src/features/projects/components/workbench/assistant/workbenchAssistantShared.ts`
- [ ] `src/stores/providerModels.ts`
- [ ] `src/pages/settings/Tooling.tsx` or a new AI providers settings page
- [ ] `src/router/routes.tsx`

Tasks:

- [ ] Add Cozea `providerInstances.ts` UI projection helper.
- [ ] Add instance-aware model option helpers.
- [ ] Convert favorites to `{ instanceId, model }`.
- [ ] Add legacy local-storage migration for old favorites.
- [ ] Convert composer drafts to instance-based selections.
- [ ] Convert `modelOptionsByProvider` to `modelOptionsByInstance`.
- [ ] Convert picker sidebar tabs from provider kind to instance id.
- [ ] Resolve icons from instance driver.
- [ ] Show display name for custom instances.
- [ ] Show accent color for custom instances.
- [ ] Show unavailable-instance messaging.
- [ ] Add provider instance settings UI.
- [ ] Support adding instances.
- [ ] Support deleting non-default instances.
- [ ] Support disabling instances.
- [ ] Support editing custom models per instance.
- [ ] Support editing instance env vars.
- [ ] Preserve legacy provider settings editor until covered by instance UI.

Acceptance:

- [ ] Picker can show `Codex`, `Codex Work`, and `Cursor` separately.
- [ ] Selecting a model stores an instance id.
- [ ] Favorites are per instance.
- [ ] Deleted/unavailable instances do not crash the composer.

## Phase 9: Text Generation

T3 references:

- [ ] `apps/server/src/textGeneration/*`
- [ ] `apps/server/src/provider/ProviderDriver.ts`
- [ ] `apps/server/src/provider/Drivers/*Driver.ts`

Cozea targets:

- [ ] `electron/assistant-runtime/git/Services/TextGeneration.ts`
- [ ] `electron/assistant-runtime/git/Layers/RoutingTextGeneration.ts`
- [ ] `electron/assistant-runtime/git/Layers/CodexTextGeneration.ts`
- [ ] `electron/assistant-runtime/git/Layers/ClaudeTextGeneration.ts`
- [ ] `electron/assistant-runtime/git/Layers/CursorTextGeneration.ts`
- [ ] `electron/assistant-runtime/git/Layers/OpenCodeTextGeneration.ts`
- [ ] `electron/assistant-runtime/git/Layers/GitManager.ts`

Tasks:

- [x] Route text generation by instance id.
- [x] Use the selected instance's driver-owned text generation closure.
- [x] Keep default text generation instance fallback.
- [x] Update Git/PR summary flows to use instance-based `textGenerationModelSelection`.
- [x] Pass model options only to the selected instance.
- [x] Return clear errors for disabled/unavailable selected instances.

Acceptance:

- [ ] Git text generation works with default `codex` in an end-to-end runtime smoke test.
- [ ] Git text generation works with a custom same-driver instance in an end-to-end runtime smoke test.
- [x] Disabled/unavailable text generation selections fail clearly.

## Phase 10: Runtime Lifecycle

T3 references:

- [ ] `apps/server/src/provider/Layers/ProviderService.ts`
- [ ] `apps/server/src/provider/Layers/ProviderSessionReaper.ts`
- [ ] `apps/server/src/provider/acp/AcpSessionRuntime.ts`
- [ ] `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

Cozea targets:

- [ ] `electron/assistant-runtime/provider/Layers/ProviderService.ts`
- [ ] `electron/assistant-runtime/provider/Layers/ProviderSessionReaper.ts`
- [ ] `electron/assistant-runtime/orchestration/Layers/ProviderCommandReactor.ts`
- [ ] `src/features/projects/components/workbench/useAssistantRuntimeSync.ts`
- [ ] `src/lib/wsNativeApi.ts`

Tasks:

- [ ] Confirm workbench open does not call provider `startSession`.
- [ ] Start provider processes only on turn send, explicit resume, or required recovery.
- [ ] Preserve `sendTurn` recovery through persisted bindings.
- [ ] Avoid route-local provider lifecycle ownership.
- [ ] Keep idle reaper from stopping active turns.
- [ ] Tune idle TTL for local Electron UX.
- [ ] Add logs for start source: new, adopt-existing, resume-thread, instance-change.

Acceptance:

- [ ] Opening/closing the same thread repeatedly does not spawn new CLI processes.
- [ ] Sending a turn after reopen uses the existing live session.
- [ ] Sending a turn after app restart resumes when provider supports it.

## Phase 11: Tests

T3 references:

- [ ] `packages/contracts/src/providerInstance.test.ts`
- [ ] `packages/contracts/src/orchestration.test.ts`
- [ ] `packages/contracts/src/settings.test.ts`
- [ ] `apps/server/src/provider/Layers/ProviderService.test.ts`
- [ ] `apps/server/src/provider/Layers/ProviderInstanceRegistryLive.test.ts`
- [ ] `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`
- [ ] `apps/web/src/modelSelection.test.ts`
- [ ] `apps/web/src/modelSelectionPersistence.test.ts`

Cozea targets:

- [ ] Add tests near changed modules, following current repo patterns.

Tasks:

- [ ] Contract tests for provider instance schemas.
- [ ] Contract tests for legacy model selection decode.
- [ ] Settings patch tests for provider instance map replacement.
- [ ] Migration tests for provider session runtime backfill.
- [ ] Migration tests for projection thread session backfill.
- [ ] Provider instance registry reconcile tests.
- [ ] ProviderService instance routing tests.
- [ ] ProviderService recovery tests.
- [ ] ProviderCommandReactor instance-change tests.
- [ ] Cursor adapter concurrent start test.
- [ ] UI helper tests for provider instance entries.
- [ ] Model picker tests for favorites and unavailable instances.

Acceptance:

- [ ] Tests cover the main migration path from provider kind to instance id.
- [ ] Tests cover same-driver multiple instances.
- [ ] Tests cover unknown/unavailable instance behavior.
- [ ] Tests avoid wall-clock sleeps where fakes/refs are possible.

## Definition Of Done

- [ ] A user can configure at least two instances of the same provider driver.
- [ ] The model picker can select models from each instance separately.
- [ ] A thread persists its selected provider instance.
- [ ] Reopening a thread does not reconnect to a CLI unless a turn/recovery requires it.
- [ ] Sending a turn routes to the persisted instance.
- [ ] Provider processes are scoped per instance and per thread.
- [ ] Deleted, unknown, and invalid instances are surfaced as unavailable.
- [ ] Existing legacy settings and local data migrate without manual cleanup.
- [ ] Each implementation slice was checked against the T3 reference files before editing.

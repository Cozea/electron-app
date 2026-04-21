# Agent Pipeline Restoration Audit

Date: 2026-04-20

## Purpose

This document is a code-grounded audit of the current assistant provider pipeline in `electron-app-main`, compared against the upstream implementation in `t3code-main`.

The goal is to answer four questions precisely:

1. What is already ported and working?
2. What is still incomplete?
3. Which missing pieces actually explain the broken or degraded agent surfaces?
4. What should be restored first so we stop spending time in the wrong layer?

This report was written after reading the current local code, comparing it to upstream, and checking the frontend surfaces that consume provider state.

## Short Version

The earlier diagnosis that `makeManagedServerProvider.ts` still needed to be rebuilt was wrong for this branch. That file is already effectively ported. The real shared regressions are elsewhere:

1. The `ServerProvider` contract is still flattened in `shared/assistant-contracts/server.ts`.
2. `electron/assistant-runtime/provider/providerSnapshot.ts` is still downgraded.
3. Claude and Codex are the materially incomplete provider ports.
4. Cursor and OpenCode are much closer to upstream than Claude/Codex, but they are still constrained by the downgraded shared contracts/helpers.

The provider model picker and status banner are not the main problem. The pipeline feeding them is.

## Scope And Method

Compared local files in `/Users/admin/Downloads/electron-app-main` against upstream files in `/Users/admin/Downloads/t3code-main`, with particular focus on:

- `shared/assistant-contracts/server.ts`
- `electron/assistant-runtime/provider/providerSnapshot.ts`
- `electron/assistant-runtime/provider/makeManagedServerProvider.ts`
- `electron/assistant-runtime/provider/Layers/ClaudeProvider.ts`
- `electron/assistant-runtime/provider/Layers/CodexProvider.ts`
- `electron/assistant-runtime/provider/Layers/CursorProvider.ts`
- `electron/assistant-runtime/provider/Layers/OpenCodeProvider.ts`
- frontend surfaces that consume provider models, auth state, and skills

## Verified Snapshot

### Line-count comparison

| File | Local | Upstream | Delta |
| --- | ---: | ---: | ---: |
| `ClaudeProvider.ts` | 401 | 827 | -426 |
| `CodexProvider.ts` | 538 | 649 | -111 |
| `CursorProvider.ts` | 1113 | 1136 | -23 |
| `OpenCodeProvider.ts` | 336 | 342 | -6 |
| `providerSnapshot.ts` | 135 | 163 | -28 |
| `makeManagedServerProvider.ts` | 156 | 156 | 0 |
| `shared/assistant-contracts/server.ts` | 104 | 239 | -135 |

### First conclusion

The largest remaining gaps are not evenly distributed. Claude and Codex are still heavily truncated. Cursor and OpenCode are much closer to parity. The managed provider engine itself is not where the biggest remaining work sits.

## What Is Already Restored

### `makeManagedServerProvider.ts` is already in good shape

Local file:

- `electron/assistant-runtime/provider/makeManagedServerProvider.ts:19` already accepts `initialSnapshot`
- `electron/assistant-runtime/provider/makeManagedServerProvider.ts:21` already accepts `enrichSnapshot`
- `electron/assistant-runtime/provider/makeManagedServerProvider.ts:66` already restarts background enrichment fibers
- `electron/assistant-runtime/provider/makeManagedServerProvider.ts:140` already kicks off a forced refresh after the initial synchronous snapshot exists

Upstream diff on this file is effectively import-path drift only:

- local imports `@cozea/assistant-contracts`
- upstream imports `@t3tools/contracts`
- local imports `ServerSettingsError` from a local file
- upstream imports it from contracts

Functional implication:

- Do not spend restoration time re-porting `initialSnapshot`
- Do not spend restoration time re-porting `enrichSnapshot`
- Do not treat this engine as the current root blocker

### Cursor already has the managed-provider lifecycle pieces

Local file already includes:

- `buildInitialCursorProviderSnapshot` at `electron/assistant-runtime/provider/Layers/CursorProvider.ts:51`
- `discoverCursorModelCapabilitiesViaAcp` at `electron/assistant-runtime/provider/Layers/CursorProvider.ts:458`
- `initialSnapshot` wiring at `electron/assistant-runtime/provider/Layers/CursorProvider.ts:1076`
- `enrichSnapshot` wiring at `electron/assistant-runtime/provider/Layers/CursorProvider.ts:1078`

This is important because it means Cursor is not a "start from zero" port anymore.

### OpenCode already has a pending snapshot and inventory-based status check

Local file already includes:

- `makePendingOpenCodeProvider` at `electron/assistant-runtime/provider/Layers/OpenCodeProvider.ts:130`
- provider status check backed by OpenCode inventory loading at `electron/assistant-runtime/provider/Layers/OpenCodeProvider.ts:172`
- `initialSnapshot` wiring at `electron/assistant-runtime/provider/Layers/OpenCodeProvider.ts:328`

Also important:

- upstream `OpenCodeProvider.ts` does **not** use `enrichSnapshot`
- local `OpenCodeProvider.ts` also does **not** use `enrichSnapshot`

So "restore `enrichSnapshot` in OpenCode for parity" is not the correct parity target.

## The Real Cross-Cutting Regressions

### 1. `ServerProvider` is still flattened

Local `shared/assistant-contracts/server.ts` defines:

- `ServerProviderAuthStatus` only
- `ServerProvider.authStatus` at `shared/assistant-contracts/server.ts:65`
- no `ServerProviderAuth` object
- no `ServerProviderSlashCommand`
- a much smaller `ServerConfig`

Upstream `packages/contracts/src/server.ts` defines:

- `ServerProviderAuth` object at `.../t3code-main/packages/contracts/src/server.ts:46`
- `ServerProvider.auth` at `.../t3code-main/packages/contracts/src/server.ts:90`
- `ServerProviderSlashCommand` at `.../t3code-main/packages/contracts/src/server.ts:66`
- `ServerProvider.slashCommands` at `.../t3code-main/packages/contracts/src/server.ts:94`
- a richer `ServerConfig` with environment/auth/observability fields

What this breaks:

1. Provider auth can only be represented as `"authenticated" | "unauthenticated" | "unknown"`.
2. Subscription labels like "Claude Pro", "Cursor Business", or Codex enterprise-specific auth labels cannot be surfaced through the contract.
3. Claude slash command discovery has nowhere to land even if it is reimplemented.
4. Every downstream consumer, test, and payload still assumes the flattened shape.

This is one of the two biggest real blockers.

### 2. `providerSnapshot.ts` is still downgraded

Local `providerSnapshot.ts` has three critical regressions:

1. `ProviderProbeResult` uses `authStatus` instead of structured `auth`
2. `providerModelsFromSettings(...)` takes only 3 arguments
3. `buildServerProvider(...)` does not accept `slashCommands` or `skills`

Local evidence:

- `electron/assistant-runtime/provider/providerSnapshot.ts:19-25`
- `electron/assistant-runtime/provider/providerSnapshot.ts:80-84`
- `electron/assistant-runtime/provider/providerSnapshot.ts:95-100`
- `electron/assistant-runtime/provider/providerSnapshot.ts:106-123`

Upstream evidence:

- `.../t3code-main/apps/server/src/provider/providerSnapshot.ts:23-29`
- `.../t3code-main/apps/server/src/provider/providerSnapshot.ts:103-108`
- `.../t3code-main/apps/server/src/provider/providerSnapshot.ts:119-124`
- `.../t3code-main/apps/server/src/provider/providerSnapshot.ts:130-150`

The most important local bug is here:

```ts
customEntries.push({
  slug: normalized,
  name: normalized,
  isCustom: true,
  capabilities: null,
});
```

That means settings-defined custom models lose provider-specific default capabilities instead of inheriting them.

Impact by provider:

- Claude custom models lose the default Claude capability set
- Codex custom models lose the default Codex capability set
- OpenCode custom models lose `DEFAULT_OPENCODE_MODEL_CAPABILITIES`
- Cursor is less visibly affected because upstream intentionally feeds `EMPTY_CAPABILITIES`, which is close to the UI fallback anyway

This is the second biggest real blocker.

### 3. Skills are present in the UI contract, but effectively dead in the provider pipeline

Local `ServerProvider` still includes `skills` with a decode default:

- `shared/assistant-contracts/server.ts:69`

The frontend already consumes provider skills:

- `src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx:584-602`
- `src/features/projects/components/assistant/chat/CozeaChatSurface.tsx:633`
- `src/features/projects/components/assistant/chat/ComposerPromptEditor.tsx` uses the provided skills list to influence the editor state

But locally:

- `buildServerProvider(...)` does not accept `skills`
- the local provider layers do not pass `skills`
- Codex's upstream discovery path that provides skills is missing

So the surface is present, but the provider pipeline feeding it is incomplete.

## Provider-By-Provider Audit

## Claude

### Current local state

Local Claude is a straightforward version-check plus auth-status probe implementation.

Evidence:

- model assembly via downgraded helper at `electron/assistant-runtime/provider/Layers/ClaudeProvider.ts:235-239`
- provider result built with `authStatus` only at `electron/assistant-runtime/provider/Layers/ClaudeProvider.ts:361-372`
- live layer wired without pending snapshot or capability cache at `electron/assistant-runtime/provider/Layers/ClaudeProvider.ts:378-399`

### What is missing versus upstream

1. Opus 4.7 version gating
   - upstream has `supportsClaudeOpus47` at `.../ClaudeProvider.ts:141`
   - upstream has version-sensitive built-in model filtering at `.../ClaudeProvider.ts:145`
   - upstream has an upgrade message formatter at `.../ClaudeProvider.ts:154`

2. Auth metadata extraction
   - upstream has `claudeAuthMetadata(...)` at `.../ClaudeProvider.ts:389`
   - local has no equivalent

3. Slash command discovery
   - upstream has `parseClaudeInitializationCommands(...)` at `.../ClaudeProvider.ts:420`
   - upstream has `dedupeSlashCommands(...)` at `.../ClaudeProvider.ts:444`
   - upstream has `probeClaudeCapabilities(...)` at `.../ClaudeProvider.ts:494`
   - local has none of these

4. Pending provider snapshot
   - upstream has `makePendingClaudeProvider(...)` at `.../ClaudeProvider.ts:748`
   - local has no equivalent

5. Cached capability probing
   - upstream creates `subscriptionProbeCache` at `.../ClaudeProvider.ts:794`
   - local has no cache layer for Claude capability/auth enrichment

### Why it matters

Without these pieces, Claude currently cannot:

- gate unsupported models based on actual CLI version
- surface richer auth metadata
- discover slash commands from the CLI
- boot with an explicit pending snapshot that resembles upstream behavior

Claude is therefore still a materially incomplete port.

## Codex

### Current local state

Local Codex is also still simplified. It performs a version check, support check, and login-status probe, but the richer discovery/account pipeline is absent.

Evidence:

- model assembly via downgraded helper at `electron/assistant-runtime/provider/Layers/CodexProvider.ts:336-340`
- provider result built with `authStatus` only at `electron/assistant-runtime/provider/Layers/CodexProvider.ts:500-505`
- live layer wired without pending snapshot or discovery cache at `electron/assistant-runtime/provider/Layers/CodexProvider.ts:511-536`

### What is missing versus upstream

1. Discovery probe
   - upstream has `probeCodexCapabilities(...)` at `.../CodexProvider.ts:305`
   - local does not

2. Account-aware model adjustment
   - upstream uses `adjustCodexModelsForAccount(...)` at `.../CodexProvider.ts:495`
   - local does not

3. Structured auth subtype/label helpers
   - upstream uses `codexAuthSubType(...)` at `.../CodexProvider.ts:533`
   - upstream uses `codexAuthSubLabel(...)` at `.../CodexProvider.ts:534`
   - local does not

4. Pending snapshot
   - upstream has `makePendingCodexProvider(...)` at `.../CodexProvider.ts:555`
   - local does not

5. Discovery cache
   - upstream creates `accountProbeCache` at `.../CodexProvider.ts:602`
   - local does not

6. Skill propagation
   - upstream carries `skills` through the provider result at multiple points
   - local does not have the discovery path or helper shape required to do this

### Why it matters

Without these pieces, Codex currently cannot:

- tailor model availability to the discovered account state
- populate the provider skill list
- expose richer auth labeling
- boot with the same pending/provider-refresh behavior as upstream

Codex is the other materially incomplete provider port.

## Cursor

### Current local state

Cursor is much closer to upstream than Claude or Codex.

Evidence:

- pending snapshot exists at `electron/assistant-runtime/provider/Layers/CursorProvider.ts:51`
- ACP capability discovery exists at `electron/assistant-runtime/provider/Layers/CursorProvider.ts:458`
- `checkCursorProviderStatus(...)` is substantial and already does real CLI/about probing at `electron/assistant-runtime/provider/Layers/CursorProvider.ts:928`
- managed enrichment is wired at `electron/assistant-runtime/provider/Layers/CursorProvider.ts:1078-1108`

### What is still missing or downgraded

1. Structured auth object
   - local `CursorAboutResult` still uses `authStatus` at `electron/assistant-runtime/provider/Layers/CursorProvider.ts:589-594`
   - upstream uses `auth` at `.../CursorProvider.ts:589-594`

2. Subscription label extraction
   - upstream has `cursorAuthMetadata(...)` at `.../CursorProvider.ts:693`
   - local has no equivalent

3. Provider helper still uses 3-arg `providerModelsFromSettings(...)`
   - local fallback path at `electron/assistant-runtime/provider/Layers/CursorProvider.ts:567`
   - local snapshot builder at `electron/assistant-runtime/provider/Layers/CursorProvider.ts:615-619`
   - local enrichment publish path at `electron/assistant-runtime/provider/Layers/CursorProvider.ts:1096-1100`
   - upstream passes `EMPTY_CAPABILITIES` in all of these places

### Why this matters

Cursor's core discovery pipeline is already present. Its remaining issues are mostly shared-layer mismatches plus the missing subscription metadata helper. This is a cleanup-and-contracts problem, not a total provider rewrite problem.

## OpenCode

### Current local state

OpenCode is also close to upstream.

Evidence:

- `DEFAULT_OPENCODE_MODEL_CAPABILITIES` exists in `electron/assistant-runtime/provider/opencodeRuntime.ts:34`
- inventory models are flattened with capabilities in `electron/assistant-runtime/provider/opencodeRuntime.ts:166-177`
- pending snapshot exists at `electron/assistant-runtime/provider/Layers/OpenCodeProvider.ts:130`
- live provider uses `initialSnapshot` at `electron/assistant-runtime/provider/Layers/OpenCodeProvider.ts:322-330`

### What is still missing or downgraded

1. Structured auth object
   - local still returns `authStatus` only
   - upstream returns `auth: { status: ... }`

2. Provider helper still uses 3-arg `providerModelsFromSettings(...)`
   - local pending snapshot at `electron/assistant-runtime/provider/Layers/OpenCodeProvider.ts:132-136`
   - local fallback path at `electron/assistant-runtime/provider/Layers/OpenCodeProvider.ts:190-194`
   - local disabled path at `electron/assistant-runtime/provider/Layers/OpenCodeProvider.ts:211-215`
   - local live inventory path at `electron/assistant-runtime/provider/Layers/OpenCodeProvider.ts:277-281`
   - upstream passes `DEFAULT_OPENCODE_MODEL_CAPABILITIES` in all of these places

3. Longer refresh cadence difference
   - local sets `refreshInterval: "1 hour"` at `electron/assistant-runtime/provider/Layers/OpenCodeProvider.ts:330`
   - upstream relies on the default interval
   - this is a difference, but not the main capability regression

### Important nuance

OpenCode inventory models already get explicit capabilities when flattened. The shared helper regression mainly hurts OpenCode's settings-defined custom models and fallback paths, not the entire inventory path.

### Why this matters

OpenCode does not need a full architectural rebuild. It mainly needs the shared contract/helper fixes and then a small provider cleanup pass.

## Frontend Surface Impact

## Model option controls depend on `capabilities`

Local UI capability behavior is defined in `src/stores/providerModels.ts`.

Relevant lines:

- `src/stores/providerModels.ts:13-19` defines `EMPTY_CAPABILITIES`
- `src/stores/providerModels.ts:54-61` resolves capabilities from the provider snapshot
- `src/stores/providerModels.ts:95-105` gates Claude thinking, effort, fast mode, and context-window options based on capabilities
- `src/stores/providerModels.ts:79-88` gates Codex reasoning effort and fast mode based on capabilities

That means the helper regression in `providerSnapshot.ts` directly affects whether custom models expose:

- thinking toggles
- reasoning effort selectors
- fast mode
- context window selectors

Important nuance:

- this matters most for Claude, Codex, and OpenCode custom models
- Cursor intentionally uses empty capabilities for fallback/custom models upstream, so the visual difference there is smaller

## Skills are wired in the UI, but not being fed properly

The workbench controller extracts `$skillName` tokens from the prompt and filters against the provider's advertised skills:

- `src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx:584-602`

The composer and chat surface already accept provider skills:

- `src/features/projects/components/assistant/chat/CozeaChatSurface.tsx:633`
- `src/features/projects/components/assistant/chat/ComposerPromptEditor.tsx`

So the surface is already ready for provider skills. The missing piece is provider-side discovery and propagation, especially for Codex.

## Auth labels are not the current UI bottleneck, but the contract blocks them

A repo-wide search shows lots of provider-side `authStatus` usage and tests asserting `authStatus`, but no active local UI path consuming structured provider auth metadata.

That means:

1. restoring `auth` will require a contract migration
2. the current UI is not yet using `auth.label`
3. richer auth badges cannot be added cleanly until the contract is restored

This is still worth restoring because Cursor/Claude/Codex parity depends on it.

## `slashCommands` matter for parity, but they are not the direct current UI blocker

Repo search did not show local frontend usage of `provider.slashCommands`. So:

- `slashCommands` are still part of upstream parity
- Claude still needs that discovery path restored
- but missing `slashCommands` are not the main reason the current surface feels incomplete today

## The picker and banner are not the main problem

Local vs upstream UI files are already close:

| File | Local | Upstream | Delta |
| --- | ---: | ---: | ---: |
| `ProviderModelPicker.tsx` | 248 | 241 | +7 |
| `ProviderStatusBanner.tsx` | 40 | 33 | +7 |

The diffs here are mostly:

- icon/component styling
- import path changes
- local "coming soon" handling differences

These are not the primary source of provider-surface degradation.

## Recommended Restoration Order

### Phase 1: Restore the shared contract and snapshot helper

Files:

- `shared/assistant-contracts/server.ts`
- `electron/assistant-runtime/provider/providerSnapshot.ts`

Required changes:

1. Reintroduce `ServerProviderAuth`
2. Change `ServerProvider.authStatus` back to `ServerProvider.auth`
3. Reintroduce `ServerProviderSlashCommand`
4. Restore `slashCommands` on `ServerProvider`
5. Restore the 4th `providerModelsFromSettings(...)` parameter for default custom-model capabilities
6. Restore `buildServerProvider(...)` support for `slashCommands` and `skills`

Why this goes first:

- Claude/Codex parity work depends on these contracts existing
- OpenCode and Cursor cleanup also depend on the 4th helper arg
- doing provider work before this will create rework

### Phase 2: Migrate consumers and tests to the restored contract

Files likely impacted:

- provider tests under `electron/assistant-runtime/provider/Layers/ProviderRegistry.test.ts`
- websocket/runtime tests such as `electron/assistant-runtime/wsServer.test.ts`
- any runtime payload serialization touching `ServerProvider`

Why this goes second:

- the repo currently has many assertions against `authStatus`
- trying to restore provider internals first will leave the test surface inconsistent

### Phase 3: Finish Claude properly

Files:

- `electron/assistant-runtime/provider/Layers/ClaudeProvider.ts`

Bring back:

1. `supportsClaudeOpus47(...)`
2. version-sensitive built-in model filtering
3. `claudeAuthMetadata(...)`
4. slash-command discovery helpers
5. `probeClaudeCapabilities(...)`
6. `makePendingClaudeProvider(...)`
7. short-lived capability/auth cache

Reason:

- Claude is still missing a large amount of real upstream behavior
- this is not cosmetic parity; it materially changes what the surface can show and what models are valid

### Phase 4: Finish Codex properly

Files:

- `electron/assistant-runtime/provider/Layers/CodexProvider.ts`

Bring back:

1. `probeCodexCapabilities(...)`
2. account discovery integration
3. `adjustCodexModelsForAccount(...)`
4. `codexAuthSubType(...)`
5. `codexAuthSubLabel(...)`
6. `makePendingCodexProvider(...)`
7. `accountProbeCache`
8. `skills` propagation into the provider snapshot

Reason:

- Codex is the other provider whose pipeline is still materially incomplete
- the skills surface depends on this

### Phase 5: Reconcile Cursor and OpenCode against the restored shared layer

Files:

- `electron/assistant-runtime/provider/Layers/CursorProvider.ts`
- `electron/assistant-runtime/provider/Layers/OpenCodeProvider.ts`

Required cleanup:

1. swap `authStatus` usage to structured `auth`
2. update all `providerModelsFromSettings(...)` call sites to pass the correct default capabilities
3. add `cursorAuthMetadata(...)`
4. keep OpenCode aligned with upstream's actual design, which does not require `enrichSnapshot`

Reason:

- these providers are mostly there already
- after phases 1 through 4, this becomes a cleanup pass rather than a rescue operation

### Phase 6: Only then decide if UI changes are still needed

After the pipeline is corrected, reassess:

1. whether provider auth labels should be displayed in the UI
2. whether slash commands should get a local surface
3. whether any picker/banner changes are still necessary

Reason:

- fixing UI first would treat symptoms, not cause

## What Not To Waste Time On

1. Do not rebuild `makeManagedServerProvider.ts`. It is already effectively ported.
2. Do not force OpenCode into an `enrichSnapshot` shape just because Cursor uses one. Upstream OpenCode does not.
3. Do not start with `ProviderModelPicker.tsx` or `ProviderStatusBanner.tsx`. They are not the main regression source.
4. Do not judge parity only by file size. Use symbol-level and behavior-level comparison.

## Symbol Presence Summary

| Symbol / Behavior | Local | Upstream | Notes |
| --- | --- | --- | --- |
| `initialSnapshot` in managed provider | yes | yes | already ported |
| `enrichSnapshot` in managed provider | yes | yes | already ported |
| `supportsClaudeOpus47` | no | yes | Claude still incomplete |
| `claudeAuthMetadata` | no | yes | Claude still incomplete |
| `probeClaudeCapabilities` | no | yes | Claude still incomplete |
| `makePendingClaudeProvider` | no | yes | Claude still incomplete |
| `probeCodexCapabilities` | no | yes | Codex still incomplete |
| `adjustCodexModelsForAccount` | no | yes | Codex still incomplete |
| `accountProbeCache` | no | yes | Codex still incomplete |
| `makePendingCodexProvider` | no | yes | Codex still incomplete |
| `buildInitialCursorProviderSnapshot` | yes | yes | Cursor mostly ported |
| `discoverCursorModelCapabilitiesViaAcp` | yes | yes | Cursor mostly ported |
| `cursorAuthMetadata` | no | yes | Cursor needs cleanup |
| `makePendingOpenCodeProvider` | yes | yes | OpenCode mostly ported |
| `DEFAULT_OPENCODE_MODEL_CAPABILITIES` | yes | yes | present locally |
| `enrichSnapshot` in OpenCode provider | no | no | not an actual parity gap |

## Final Assessment

If the goal is to restore the "agent surfaces" that feel incomplete after the t3 port, the work should be framed like this:

1. fix the shared provider contract
2. fix the shared provider snapshot helper
3. fully restore Claude
4. fully restore Codex
5. then do the Cursor/OpenCode contract cleanup pass

The current branch does **not** need another speculative architecture rewrite. It needs a precise recovery of the missing shared contracts plus the still-truncated Claude and Codex provider logic.

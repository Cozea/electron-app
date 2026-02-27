# AI Runtime Unification Plan

## Goals

- Collapse fragmented runtime/profile/provider logic into one coherent contract.
- Keep behavior non-breaking while reducing maintenance cost.
- Adopt OpenCode-style continuation semantics for Responses-based providers.
- Make `plan` and `build` the primary agent profiles, with shared policy composition.

## Current Pain Points

- Profile/policy duplication across frontend and backend (`runtimeProfiles.ts`, server runtime policy files).
- Transport and continuation behavior differs by surface (assistant panel vs builder).
- Provider options are assembled across multiple layers, making debugging and parity difficult.
- Tool policy and capability gating are split between profile logic, resolver logic, and per-surface conditionals.

## OpenCode Gap Snapshot (Feb 2026)

This section captures the current state after runtime unification work and compares Cozea's active path to OpenCode's session pipeline.

### Parity Already Landed

- Shared chat execution path is active across surfaces through `chatExecutor` and `useAiChatTransport`.
- Contract validation and message normalization are now enforced at runtime boundaries.
- Continuation persistence and provider linkage safeguards exist for Responses-style providers.
- Duplicate item recovery exists at both provider normalization and builder recovery layers.

### Remaining Gaps (Prioritized)

1. `P1` Retry-hint handling is builder-only
   - Builder reads `data-retry-hint` and gates continuation retries.
   - Wizard and assistant surfaces currently surface generic errors only.
   - Impact: behavior inconsistency and weaker recovery UX outside builder.

2. `P1` Google provider tools are hard-disabled in registry
   - `resolveToolMetadata` blocks provider tools when provider is Google (`googleProviderToolsAllowed = args.provider !== 'google'`).
   - Google provider adapters and transforms are implemented in `providerHelpers`, creating policy/runtime mismatch.
   - Impact: latent dead path, confusing capability matrix, and parity drift with OpenCode tool routing.

3. `P2` Legacy cloud runtime class is not wired
   - `CloudAgentRuntime` targets `/agent/*` routes not registered by `server/src/routes/ai.ts`.
   - Code search indicates no active references to `CloudAgentRuntime`.
   - Impact: maintenance drag and misleading architecture affordances.

4. `P2` Tooling shim residue
   - Legacy shim modules (`chatTooling`, `toolSetBuilder`) remain from pre-unification layering.
   - Impact: harder code discovery and unclear source of truth for tool assembly.

5. `P3` Surface-specific recovery logic still duplicated
   - Builder has richer continuation/error controls than assistant/wizard.
   - Impact: repeated fix effort and uneven reliability behavior.

### Recommended Next Sprint (Low-Risk Sequence)

1. Add shared retry-hint consumer utility in frontend chat runtime.
   - Reuse in builder, assistant panel, assistant project, wizard.
   - Standardize terminal vs retryable error banners and continuation reset behavior.

2. Resolve Google provider tool policy mismatch.
   - Either (a) remove hard block and rely on capability/policy checks, or (b) remove unavailable tool registrations for Google at source.
   - Add explicit regression test matrix by provider x surface x agent.

3. Remove or quarantine unused `CloudAgentRuntime` `/agent/*` path.
   - If future use is planned, add registered routes and integration tests.
   - If not planned, deprecate and remove to reduce confusion.

4. Delete dead shims and consolidate tool assembly docs.
   - Keep one authoritative path from route -> resolver -> registry -> provider options.

### Verification Additions

- Add integration coverage to assert `data-retry-hint` behavior parity across all 3 primary surfaces.
- Add policy snapshot tests for provider tool gating, including Google with/without required capabilities.
- Add smoke test ensuring no unresolved `/agent/*` runtime path is referenced by active UI flows.

## Target Architecture

### 1) Single Runtime Contract

Define one runtime payload contract used by all surfaces:

- `agentId`: `plan | build | assistant` (assistant can map to non-primary variants internally)
- `surface`: `wizard | builder | assistant_panel`
- `model`, `variantId`, `conversationId`, `organizationId`
- `execution`: `{ runtime: local | remote, projectContext? }`
- `policyOverrides`: optional, validated patch for controlled experimentation

All legacy or extra fields become invalid at the boundary.

### 2) Unified Profile Registry

Move to one source of truth for profile capabilities:

- canonical profile definitions in server runtime
- generated/derived client-safe profile metadata for UI defaults
- explicit composition layers:
  - base profile (`plan` or `build`)
  - surface adapter (wizard/builder/assistant behaviors)
  - org policy constraints
  - provider/model capability constraints

### 3) Provider Execution Pipeline

Standardize provider pipeline order:

1. incoming message sanitation
2. profile prompt composition
3. tool resolution and policy gating
4. provider option assembly
5. provider-specific message normalization
6. stream execution + usage tracking + event metadata

Each step should be pure and testable with fixtures.

### 4) OpenCode-Style Continuation State

Introduce conversation continuation state for Responses providers:

- persist per-conversation `previousResponseId` and provider conversation linkage metadata
- for continuation turns, send only incremental user/tool deltas where supported
- avoid replaying full assistant response-item history when `previousResponseId` is present
- fallback to sanitized history replay when continuation state is unavailable

This is the structural fix for duplicate response-item ID errors.

### 5) Tool Policy Unification

Centralize tool policy into a single resolver result:

- `allowedTools`
- `executionEnvironment` per tool
- `approvalPolicy`
- `providerNativeTools` + `localTools` + `serverTools`

Surfaces should consume this result directly instead of re-encoding policy in UI-specific conditionals.

## Rollout Plan

### Phase 0 - Stabilization (immediate)

- Keep server-side duplicate part-id guard for OpenAI/Copilot normalization.
- Add client transport message-id dedupe before every `/chat` request.
- Stop builder auto-continue when provider returns non-retryable duplicate item-id errors.

### Phase 1 - Contract Consolidation

- Create shared runtime schema package/types consumed by both frontend and server.
- Replace ad hoc profile fields with schema-backed payload validation.
- Add compatibility mapper for existing clients.

### Phase 2 - Continuation Engine

- Add continuation metadata persistence (conversation-scoped).
- Teach provider option builder to set `previousResponseId` from stored state.
- Update stream lifecycle to emit/store latest response linkage IDs.
- Add retry semantics that distinguish retryable vs terminal provider errors.

### Phase 3 - Policy and Tooling Merge

- Merge tool gating and profile gating into a single runtime policy module.
- Remove duplicated per-surface logic for local/server/provider tool execution decisions.
- Add snapshot tests for policy outputs by surface+agent+model.

### Phase 4 - Profile Simplification

- Promote `plan` and `build` as first-class profiles.
- Keep secondary assistant personas as lightweight overlays over `assistant`.
- Remove dead profile variants and legacy runtime field handling.

## Verification Strategy

- Unit tests for message sanitation, provider options, and policy composition.
- Integration tests for wizard, builder, assistant panel chat turns.
- Regression test fixture for duplicate response-item IDs and malformed function-call recoveries.
- Load test on long builder sessions to verify no auto-continue loops.

## Success Criteria

- No duplicate response-item ID failures across builder continuations.
- One authoritative profile registry with generated client metadata.
- Predictable provider option output given `(agent, surface, model, org settings)`.
- Reduced code ownership surface for runtime changes (fewer files touched per feature).

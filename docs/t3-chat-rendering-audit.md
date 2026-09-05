# T3 provider chat UI and state audit

> **Post-integration review, 2026-09-05T01:12Z:** the findings below describe the
> earlier pin unless explicitly updated. Local main now includes `bbf9ceab` and
> T3 `f2df43a98`, plus ongoing provider-QA edits. MCP approvals, supplied permission
> choices/details, free-text parsing, scoped question shortcuts, async questions,
> and compaction have since been integrated. The QA shell-snapshot path also
> supersedes the old all-thread global subscriptions and avoids relying on the
> legacy message projector for T3 shell turn state. Do not reimplement those fixes
> or claim the old path remains the current T3 authority. Remaining gaps and the
> reviewed implementation scope are in [chat-rendering-refactor-plan.md](chat-rendering-refactor-plan.md).

Checked at **2026-09-05T06:02:28+08:00**. Read-only application/source investigation;
this report does not authorize an implementation, provider run, runtime repin, or
settings change.

## Scope and conclusion

- Upstream: `pingdotgg/t3code`, main at
  `5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d`.
- Cozea's unchanged server pin: `46c3f1217730a819fc79e95b7684784312269602`.
- Compared the six upstream adapters, shared ingestion/projection, web timeline
  derivation/rendering, and Cozea's current dirty renderer checkout.
- Upstream has 505 commits not in the pin by ancestry; the fork has 10 not in
  upstream. These counts are not a semantic measure of missing fixes.

**There are confirmed client-state defects, not only presentation differences.**
The pinned server already distinguishes message completion from turn completion,
but Cozea's local read-model projector loses that distinction. Its second,
per-tile detail reducer also misses events, and the UI combines these two stores
using array length rather than authority/freshness. This supersedes the initial,
narrower assessment that the missing turn rules were mostly presentation-level.
The evidence supports repairing those boundaries, not discarding all adapters.
Animation and tool-accordion improvements do not repair the underlying semantics.

The expanded scope includes approvals, questions, plans, subagents/background
tasks, media, transport recovery, errors, usage, and rendering performance. The
findings below distinguish executable reproductions, source-confirmed gaps, and
newer-upstream features. This is not a claim of exhaustive live-provider QA.

## The shared model

```text
Provider-native events
  → provider adapter (native IDs, text/reasoning, tool lifecycle, turn lifecycle)
  → canonical ProviderRuntimeEvent
  → ProviderRuntimeIngestion (text segments, buffering, activity conversion)
  → orchestration events and persisted thread/message/activity/turn projections
  → client thread state
  → turn-aware timeline rows
  → Markdown / tool disclosures / final-response metadata
```

The canonical envelope separates `threadId`, `turnId`, `itemId`, `eventId`, and
provider-instance identity. Event types distinguish `content.delta`,
`item.started/updated/completed`, and `turn.started/completed/aborted`.
`streamKind` distinguishes assistant text from reasoning and other output.
Tool lifecycle data includes status, structured data, and optional parent-agent
ownership. A finished text item is not a finished turn.
[Contract](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/packages/contracts/src/providerRuntime.ts#L255).

## How each provider enters that model

| Provider | Text and tool boundaries | Turn-end authority |
| --- | --- | --- |
| Codex | App-server `item/agentMessage/delta` maps to assistant `content.delta`; item lifecycle notifications retain item IDs; command output/reasoning have separate streams. | Native `turn/completed` or `turn/aborted`, distinct from `item/completed`. |
| Claude | SDK text/thinking block deltas are normalized separately. Text blocks finalize independently; tool-use/tool-result traffic has tool identity and lifecycle. Child narration is filtered from the parent transcript; attributed child tools are preserved. | SDK result/terminal handling finalizes outstanding blocks/tools and emits one canonical turn completion. |
| Cursor | ACP message chunks and thought chunks are separate. Shared ACP runtime synthesizes assistant segment IDs and closes the current text segment at tool activity. Tool updates merge by `toolCallId`. | Completion of `session/prompt`; only the last prompt in a merged/steered turn settles it. |
| OpenCode | SDK message/part events; text snapshots and deltas are reconciled per part to avoid duplicate append. A text part's end emits item completion. Tool parts have their own states. | Session idle handling/reconciliation with active-turn, prompt-generation, admission, and cancellation guards—not completion of one assistant part. |
| Grok | ACP shared segmentation and tool normalization, with provider-specific prompt/liveness handling. | Guarded prompt completion/cancellation; overlapping prompt handling avoids premature settlement. |
| Antigravity | Official native ACP runtime feeds shared assistant/tool events; adapter handles replay metadata, subagents, commands, and questions. | Guarded prompt result/cancellation, with generation and one-shot settlement checks; some background commands can outlive the turn. |

Exact sources:
[CodexAdapter](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/server/src/provider/Layers/CodexAdapter.ts#L1540),
[ClaudeAdapter](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/server/src/provider/Layers/ClaudeAdapter.ts#L2550),
[CursorAdapter](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/server/src/provider/Layers/CursorAdapter.ts#L1048),
[OpenCodeAdapter](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/server/src/provider/Layers/OpenCodeAdapter.ts#L1568),
[GrokAdapter](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/server/src/provider/Layers/GrokAdapter.ts#L1848),
[AntigravityAdapter](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/server/src/provider/Layers/AntigravityAdapter.ts#L987),
[ACP segment boundaries](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/server/src/provider/acp/AcpSessionRuntime.ts#L1130).

The four providers exposed by Cozea today do not need four separate rendering
state machines. Grok/Antigravity coverage here describes upstream, not newly enabled
Cozea support.

## Text delivery is buffered by default

Both current upstream and Cozea's pinned server default
`enableLegacyTokenStreaming` to `false`. Ingestion buffers assistant deltas and
finalizes text on item completion, at user-interaction boundaries, and at terminal
turn cleanup. There is a 24,000-character memory safety spill. Legacy streaming
dispatches deltas as they arrive instead.

Consequently a client can receive a substantial, already-finished text segment in
one burst. The local reveal controller can smooth that arrival; it cannot reveal
tokens the server has not sent. This is an architectural explanation for bursty
delivery, **not verification of the running user's effective settings**.
[Default](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/packages/contracts/src/settings.ts#L830),
[ingestion](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts#L1745).

The projection explicitly checks whether the session is still running the same
turn before letting a completed assistant message settle it. This guard is also
present in our pinned server. Session/turn end, not a gap between messages, is the
authoritative lifecycle boundary.
[Projection guard](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/server/src/orchestration/Layers/ProjectionPipeline.ts#L1455).

## What upstream renders—and where Cozea differs

### 1. Final-response metadata, not metadata on every text item

Upstream derives the last assistant message for each turn. Unkeyed historical
messages fall back to user-message boundaries. Even the latest message is only
provisionally final while the response remains active, so metadata/copy stays
hidden until settlement. The same core rule already exists in our vendored web
source; adopting it does not require a server upgrade.

Cozea's `MessagesTimeline.tsx` supplies actions to every assistant message;
`AssistantMessageBody.tsx` reveals them when that individual message and its visual
reveal finish. It has no terminal-message or turn-settlement eligibility input.
This directly explains the intermediate narration toolbar in the screenshot.
Separately, the local projector can incorrectly complete the turn itself; see the
state findings below. The screenshot alone cannot distinguish these two defects.

### 2. A completed-turn disclosure is more than a divider

Upstream folds intermediate prose and ordinary tool activity before the terminal
answer into an expandable `Worked for…` row. Running responses do not fold. Current
upstream also handles trailing tool groups, moves response metadata after them,
and preserves special agent/background activity visibility.

Cozea creates a `turn-status` header/divider but retains the intermediate messages
and tool groups as independent rows. The appearance of a completed turn above
several answer-like blocks is therefore expected from our current code—not proof
that the provider created separate turns.

### 3. Turn lifecycle and visual response are different concepts

Upstream prioritizes the session's running turn if `latestTurn` lags. Its newer
promptless-restart rule keeps native turns since the latest user message in one
active visual response until the replacement settles. A steer with its own user
message establishes a new visual boundary.

Cozea's view model currently uses `completionTurnSettled = !isWorking` for its
completion summaries. Its local `toolPhase.ts` reasons from tools positioned after
the latest message. Neither is a full shared visual-response projection. The
heuristic is useful for busy-label placement, but must not become authority for
turn completion or final-answer eligibility. No concrete reconnect/steer failure
was reproduced in this audit; this is a source-level consistency risk.

### 4. Tool lifecycle identity and narrative placement need separate ownership

Upstream normalizes tool status/data before rendering, merges lifecycle updates
by turn/tool-call identity, and derives live labels and grouped activity from
that state. ACP coalesces repetitive progress and always emits terminal states.
Current upstream also re-homes agent-owned activity into the Agents surface.

Cozea independently parses labels/payloads, merges lifecycle rows, and now anchors
row identity/order with `timelineOrigin`. That fixed tested DOM churn, but it must
be reconciled with turn-aware placement rather than layered underneath more
independent boundary guesses. Our work-log filtering does not implement upstream's
`agentId`/`timelineBypass` routing. That is a separate integration requirement;
blindly hiding those rows before providing a destination could lose visibility.

### 5. Streaming performance is a separate layer

Current upstream has pure, stateful timeline projections that reuse structure
when only streaming text changes. Cozea already isolates presentation frames in
assistant bodies, but canonical text updates still rebuild its timeline inputs.
The two techniques solve different costs and can coexist.

Primary UI evidence:
[terminal/response/folding derivation](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/web/src/components/chat/MessagesTimeline.logic.ts#L432),
[metadata gate](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/web/src/components/chat/MessagesTimeline.logic.ts#L1110),
[metadata regression test](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/web/src/components/chat/MessagesTimeline.logic.test.ts#L848),
[work-log ownership](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/web/src/session-logic.ts#L782),
[stream projection](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/web/src/session-logic.ts#L1968).

## Confirmed client-state and interaction defects

Paths below are relative to the Cozea repository root. Reproductions used isolated
in-memory calls to existing functions; they did not send provider requests or
modify persisted conversations.

### P1 — Turn completion is corrupted in the local projection

`apps/desktop/src/features/assistant/model/orchestrationReadModelProjector.ts:340`
sets `latestTurn.state = completed` and `completedAt` on a non-streaming assistant
message, without the server's same-turn running-session guard. The turn-diff
branch also assigns completion independently. This projector is used by
`assistantStore.ts` and the active T3 path in
`apps/desktop/src/substrate/useSubstrateOrchestrationSync.ts`; it is not dead code.

**Reproduced:** a running session receiving completed intermediate narration
produces `{ session: "running", turn: "completed", completedAt: <timestamp> }`.
Some UI derives busy state from the session and masks this, while other consumers
read the corrupted turn. Both current and pinned upstream server projections
already protect this boundary.

### P1 — Live plans/reverts and snapshot authority disagree

`apps/desktop/src/features/assistant/model/threadDetailStore.ts:238` handles only
a subset of domain events. It does not apply `thread.proposed-plan-upserted` or
`thread.reverted`, but still advances `lastSequence` for them.

**Reproduced:** after a plan update and a revert-to-zero event, the detail record
retains the old plan and old message while advancing to sequence 3.

`apps/desktop/src/features/workbench/assistant/useWorkbenchAssistantTileController.tsx:483`
then chooses detail messages/activities/plans/diffs whenever their arrays are
nonempty. Stale detail wins over correct global state; an authoritative empty
detail instead falls back to potentially stale global content. Loaded state,
snapshot revision, and empty content are not interchangeable. Upstream's shared
[thread reducer](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/packages/client-runtime/src/state/threadReducer.ts#L473)
explicitly handles plan updates and reverts.

### P1 — Thread subscriptions can silently stop after disconnect

`apps/desktop/src/substrate/useTileThreadStream.ts:42` connects once per effect;
setup failures only log a warning. The T3 client's `subscribeThread` omits the
optional disconnect callback, while `effectRpcClient.ts:101` clears stream
listeners when the socket closes. Neither this path nor the global T3 subscription
loop re-establishes its streams on that event. A stable URL/thread/active flag
does not retrigger the effect. Changing dependencies/remounting may recover it;
automatic recovery and a tile-specific stale/disconnected indication are missing.

Source-confirmed; no real connection was interrupted. Current upstream has a
separate [connection supervisor and tests](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/packages/client-runtime/src/connection/supervisor.test.ts#L693).
Do not transplant a retry loop without snapshot/replay ownership and deduplication.

### P1 — Approval UI drops request types, scope, and decision context

`apps/desktop/src/features/assistant/chat/session-logic.ts:167` recognizes only
command/read/change requests. Pinned ingestion already emits MCP elicitation
approvals with `requestKind: "mcp-elicitation"`, app name, details, and options.
**Reproduced:** this valid approval produces an empty pending-approvals list.

For recognized requests, derivation drops provider-supplied options and app name.
`ComposerPendingApprovalActions.tsx` always offers four fixed choices, including
session-wide approval. `ComposerPendingApprovalPanel.tsx` displays only a category
and count, not `approval.detail`. The decision area therefore does not faithfully
represent what is being authorized or the provider's supported choices. This
does not establish that the backend accepts an unsupported decision.

Upstream renders [provided options](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/web/src/components/chat/ComposerPendingApprovalActions.tsx#L32)
and [complete approval details](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx#L17).

### P1 — Question semantics and keyboard ownership are incomplete

`session-logic.ts:255` drops `multiSelect` and rejects questions with no options.
The pinned question contract already supports `multiSelect` and permits an empty
options array. Local draft answers store one selected label and auto-advance on
selection. **Reproduced:** a multi-select request loses its flag; a free-text-only
request with `options: []` disappears entirely.

`ComposerPendingUserInputPanel.tsx:95` registers number shortcuts on `document`
without checking active tile, visibility, or `event.defaultPrevented`. Multiple
mounted question panels can react to the same digit, including a hidden chat
whose controller stays mounted. This is a source-confirmed cross-tile input risk,
not a reproduced multi-provider submission. Scope shortcuts to the visible,
focused question owner before addressing cosmetic behavior.

### P2 — Restored image attachments lose their display URL

`threadDetailStore.ts:77` only copies an incoming `previewUrl`; persisted attachment
records carry attachment IDs and metadata rather than that renderer URL.
`assistantStore.ts:316` does resolve an attachment URL, but the nonempty detail
messages override those mapped messages in the tile controller.

**Reproduced:** a canonical image attachment in a detail snapshot maps to
`previewUrl: undefined`. `MessagesTimeline.tsx:933` requires that field to show the
image and otherwise renders a placeholder. This concerns restored/received
attachments, not the composer draft preview or the separate generated-artifact
gallery. URL resolution and refresh should have one owner.

### P2 — Tool summaries can claim actions that did not complete

`toolPhase.ts:56` excludes running entries only while the presentation phase is
active. Failure detection covers `failed`/error tone, not declined/stopped states.
**Reproduced:** both an `inProgress` read and a `declined` read become “Read 1 file”
when `active` is false. A text arrival may end a presentation phase but must not
rewrite actual tool outcome. Distinguish completed, failed, declined, stopped, and
still-running/background actions before producing human-readable counts.

## Additional coverage gaps and performance risks

### Reasoning / Thinking needs distinct semantics

Added at 2026-09-04T22:23Z following the user's explicit requirement. Local code
does have a basic Thinking indicator: `deriveGenerationStatusPhase` reads
`reasoning.started`/`reasoning.completed` for the active turn, and
`ThinkingIndicatorRow` renders a shimmer. Therefore the gap is not total absence.

However, reasoning markers are filtered out of work-log rows, and the indicator
only renders when `!toolPhase.active`. That phase remains active for trailing
completed tools until another text message arrives, so a tools-to-reasoning
transition can remain presented as tool work. Also, `task.progress` gets the tone
`thinking`, and `workLogEntryIsToolLike` treats that tone as a tool: background task
progress, actual provider reasoning, and tool usage are not cleanly separated.

Acceptance requirement: distinguish provider-reported reasoning, tool execution,
assistant text, waiting for user input, and settled state within the same turn.
Do not count reasoning as tool use or infer it merely from a pause in text.
Render a distinct live Thinking state from explicit provider signals. If the
provider exposes displayable reasoning summaries, retain their identity/order
and allow compact expansion; otherwise show status only, without inventing steps
or attempting to expose unavailable internal reasoning. Apply the established
collapsed-summary/expanded-active-row shimmer rule, and clear live state on
completion, interruption, failure, or authoritative snapshot replacement.
Test tools-to-thinking-to-text transitions, repeated reasoning segments, child
task progress, and providers without reasoning signals. Review which parts the
pending upstream integration already supplies before implementation.

| Area | Local handling / missing behavior | Classification |
| --- | --- | --- |
| Final-answer metadata and turn folding | Intermediate messages get actions; completion header is not a fold; no shared terminal-response projection. | Confirmed rendering semantics gap; core rules exist in pinned upstream web source. |
| Subagents and background tasks | Work-log filtering has no `agentId`/`timelineBypass` routing; `task.started` is removed, while progress/completion are generic work entries. No corresponding provider-task/Agents surface was found in the assistant feature. Child activity can pollute parent summaries; hiding it without an alternate view would lose information. | Source-confirmed integration gap, distinct from Cozea's workbench agent tiles. |
| Plan progress | `deriveActivePlanState` exists but has no UI caller. Formal proposed-plan cards are different from runtime step progress and also suffer the stale-detail issue above. | Source-confirmed missing presentation. |
| Inline workspace media | `ChatMarkdown.tsx` customizes links, code, and tables but has no image/media resolver. A Markdown image using a local/relative workspace path is not resolved through the runtime asset service. | Source-confirmed gap; ordinary HTTP image Markdown is different. Upstream has workspace-image resolution and dedicated tests. |
| Provider-specific rich output | No Codex directive/citation parser in the local assistant renderer. Newer upstream question option values/custom-answer policy/message-response mode and general file attachments are not represented by local DTOs. | Feature/contract parity work, not proof each is currently emitted by our pin. General file attachments are newer than the pin's image-only message contract. |
| Tool diagnostics | Compact action rows intentionally remove verbose payload displays. A one-line summary needs a secondary way to inspect full command/output/error detail without reopening a dense accordion design. | Intentional density tradeoff with a diagnostic-access gap, not a request to restore pills. |
| Canonical update cost | Reveal animation frames are isolated, but incoming canonical text still rebuilds/sorts timeline inputs. Global synchronization also subscribes to every initial thread in addition to tile subscriptions; activities are not compacted like upstream's rolling context snapshots. | Source-level performance risk; no new long-response profile performed in this audit. |
| Disclosure/reading position | Current LegendList owns bottom following; no new competing scroll loop was found. Upstream has explicit disclosure scroll-anchor handling. Local expansion while reading older output still needs targeted regression QA. | Verification gap, not a demonstrated scrolling regression. |

Useful upstream references:
[workspace-image tests](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/web/src/components/ChatMarkdown.workspace-images.test.tsx),
[task surface](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/apps/web/src/components/chat/ComposerTasksBadge.tsx),
[context activity retention](https://github.com/pingdotgg/t3code/blob/5a2f3ebf6ee6eab6124ad68272c2fb5d74bc0f5d/packages/client-runtime/src/state/threadReducer.ts#L596).

Existing pieces worth retaining: GFM/table/code-copy rendering, deferred syntax
highlighting, clickable file links, renderer-only text reveal, stable recycled-row
identity, tile visibility handling, draft/history associations, generated-image
artifact handling, provider recovery banners, and context-window presentation.
Reviewing those paths did not establish that all are broken. Runtime banners do
not substitute for a disconnected thread-stream state, and successful earlier
presentation fixtures do not prove domain-event correctness.

## Recommended repair boundary and order

0. Fix client-state authority first: one tested reducer/snapshot model, correct
   item-versus-turn completion, complete plan/revert handling, authoritative empty
   snapshots, and explicit connection/replay lifecycle. Avoid competing reducers
   with independent event coverage and array-length fallbacks.

1. Establish one pure turn-aware timeline projection over canonical messages,
   activities, and session/turn state. Port the upstream semantics and relevant
   tests, adapting Cozea DTOs deliberately rather than copying the entire UI.
2. Make that projection own terminal-message eligibility, completion folding,
   trailing tools, active-response continuity, and live activity placement.
3. Keep Cozea's desired compact accordion, shimmer, reveal timing, Markdown/file
   integrations, and tile visibility as presentation downstream of those rows.
4. Treat text-delivery policy as a separate explicit decision: buffered segments
   with local reveal, or actual delta delivery with local pacing. Do not silently
   change global/provider settings as a styling fix.
5. Handle runtime/schema upgrades separately under the existing upstream-provider
   integration plan. Newer provider fixes are relevant, but repinning alone will
   not replace Cozea's custom timeline or repair its missing rendering gates.
6. Restore interaction fidelity: all emitted approval kinds and supplied options,
   full decision details, question cardinality/free-text behavior, and focused-tile
   shortcut ownership. These are correctness work, not optional visual polish.
7. Integrate task/agent ownership, plan progress, attachment/media resolution, and
   diagnostic detail access. Add newer rich-output contracts only alongside their
   corresponding runtime upgrade, preserving Cozea-specific integrations.

Acceptance fixtures should cover commentary→tools→commentary→tools→final answer
in one turn for every provider; burst and delta delivery; tool failure followed by
successful continuation; stop/error/approval; promptless restart and steering;
snapshot/reconnect parity; trailing/background tools; and row recycling. Assert
one final-response footer, correct active state, stable identities, and exact text.
Also assert plan/revert live-versus-snapshot parity, disconnect/replay recovery,
MCP approvals, provider-limited decision options, multi-select and no-option
questions, simultaneous/hidden question tiles, restored attachments, and truthful
declined/stopped/background tool summaries.

## Verification and limitations

- Fetched upstream main and inspected an archive at the exact SHA above. Neither
  vendored checkout nor server pin changed; fetch updated only Git metadata.
- Reviewed adapter, ingestion, projection, UI source and relevant upstream tests.
  Did not install dependencies or run upstream's full suite, all six live
  providers, or paid prompts.
- Existing local focused timeline/tool tests: **67 passed across four files**.
  Their success does not validate missing turn-aware behavior; upstream includes
  explicit metadata/continuity cases not represented by our current row model.
- Expanded existing detail-store, session-logic, and context-window checks:
  **16 passed across three files** (83 total across seven files for this audit).
  Existing Vite config-loader warning remains.
- Additional isolated Bun probes reproduced premature local turn completion,
  stale plan/revert state, question field loss/free-text rejection, missing MCP
  approvals, missing restored-image URLs, and inaccurate inactive-tool summaries.
  They exited successfully; Bun printed an existing duplicate `noEmit` warning
  and an internal tsconfig directory-mismatch warning. Probes were diagnostic
  calls, not committed regression tests.
- No application source/settings changes, build, deployment, or remote writes.
  This report and the required continuity note are the only intended workspace
  documentation changes. Existing dirty work remains intact.

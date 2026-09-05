# Cozea conversation rendering refactor

## Authorization and reviewed baseline

2026-09-05T01:12Z. The user requested a substantial refactor close to T3's
conversation semantics while preserving Cozea's integrations and visual choices.
They authorized creating an implementation goal after reviewing the upstream
integration and confirmed that the related work is ready for this handoff.

Reviewed local main `bbf9ceab`, including `c6f9e42a` conversation features,
`04751b21` contracts, and the cancellation-state repair. T3 pin is
`f2df43a98bc42936dd2a031d832c8c4dae53398a`. The other task remains active on live
provider qualification. Its uncommitted shell snapshot, RPC timeout, and
late-buffered-text fixes are present and were inspected, not modified.

Before source edits, capture a stable isolated working baseline including those
handoff changes, or use their finalized commits if available. Preserve the root
checkout and the unrelated collaboration worktree. Do not overwrite, reset,
commit, or accidentally omit another task's unfinished changes.

This goal does not authorize deployment, releases, remote pushes, new dependencies,
new provider enablement, authentication changes, or production data changes.
Ask before any required main-process/bootstrap or database-schema expansion.

## What the integration already supplies

| Area | Reviewed result | Remaining obligation |
| --- | --- | --- |
| Approvals | MCP/unknown requests retained; provider decisions and warnings parsed; full details displayed; unknown grants have conservative fallback. | Preserve these behaviors, add end-to-end renderer coverage and app identity where provided. |
| Questions | Empty-option questions and metadata now survive parsing; async questions have separate durable drafts/retry identity; shortcuts belong to the card. | Both blocking and async UI still store a single answer despite `multiSelect`; test native values, duplicate labels, custom-answer policy, persistence and retry semantics together. |
| Compaction and updates | Idle compaction, controlled opt-in update continuation, setup/capability gating integrated. | Preserve ownership, drafts, history and interruption behavior through the refactor. |
| Cancellation | Runtime and local checkpoint handling preserve interrupted/error state; pending QA edits keep late buffered text from reactivating busy state. | Retain regressions and model late events by actual turn identity. |
| Shell metadata | Pending QA code consumes sparse shell snapshots/upserts directly and removes global subscriptions to every thread. | Preserve shell/detail separation; add robust reconnect, freshness and lifecycle ownership. |
| History attachments | A non-image name renderer exists. | Both local mappers still force attachments to `image`, defeating that renderer; detail images also lack resolved URLs. |

The old projector still completes a turn from a completed text message, but the
new T3 shell path no longer feeds those domain events through it. Treat this as
legacy-path divergence to remove or reconcile, not proof that current T3 shell
state still follows that broken path.

## Remaining defects rechecked

- Detail reducer still ignores plan upserts and reverts while advancing sequence.
  In-memory probe retained the old plan/message at sequence 3.
- Tile controller still selects detail arrays based on nonempty length instead
  of authoritative loaded state/revision.
- Snapshot image attachments still map to `previewUrl: undefined`; a native file
  attachment is rewritten to `type: image` by the same mapper.
- Inactive tool summaries still describe an in-progress read as “Read 1 file”.
- Terminal-message actions, completed-turn folding, trailing tools, response
  continuity, and stream structure reuse remain missing from the custom timeline.
- Reasoning has a basic live indicator but no unified phase/segment model;
  trailing tool phase can suppress it and task progress uses a thinking tone.
- Thread/shell subscriptions still need disconnect/replay ownership; the new
  shell materializer is not itself a connection supervisor.
- Provider-owned tasks/agents, runtime step plans, inline workspace media,
  supported rich-output directives/citations, and compact diagnostic access need
  integration with the actual pinned contracts rather than generic tool rows.

## Architecture

Use the pinned upstream's reducer and timeline semantics as the reference, with
explicit Cozea adaptation at the boundary. Avoid another set of duplicated
message/turn heuristics hidden in components.

```text
T3 shell metadata + thread snapshots/events
  → authoritative typed client state and connection status
  → pure conversation projection (turns, response phases, stable item ownership)
  → memoized Cozea rows and disclosures
  → Markdown/media, tool details, requests, tasks, plans and final actions
```

Canonical content is never paced by animation. Reveal progress, disclosure state,
measurement, focus and visibility belong to presentation. A text item ending is
not a turn ending, and a tool presentation phase ending is not a successful tool.

## Implementation phases

1. **State and transport.** Adopt/adapt the complete pinned thread reducer;
   establish explicit shell/detail ownership, snapshot readiness/revision, empty
   authority, deduplication and stale-event handling. Cover plan updates, reverts,
   late terminal output, removed threads, and authoritative message replacements.
   Add reconnect/backoff/cancellation with fresh credentials and snapshot/replay
   recovery; surface disconnected/stale state. Do not assume per-thread sequences
   are globally contiguous. Remove superseded paths after verifying all callers.
2. **Conversation projection.** Port terminal-message eligibility, running-turn
   precedence, visual-response continuity, completed-turn folding, and trailing
   activity placement from the pinned upstream. Centralize stable message/tool/
   agent identity and ordering. Keep approvals and runtime completion tied to
   actual state; only terminal settled answers receive response actions.
3. **Reasoning and activity.** Distinguish reasoning, tools, assistant text,
   input-waiting and settlement within one response. Render only provider-exposed
   reasoning summaries; use Thinking status when no displayable text exists.
   Never invent hidden reasoning or count thinking as tool use. Preserve tool
   outcomes (running/completed/failed/declined/stopped) and separate background or
   child-agent activity. Add provider task/agent disclosures and plan-step progress
   using their real ownership and capabilities. Keep full diagnostic details
   accessible behind a secondary disclosure/action.
4. **Request fidelity.** Finish multi-select for blocking and async questions
   end-to-end, using the pinned wire answer encoding and native option identities.
   Preserve free text, fixed-choice restrictions, ordinary composer drafts,
   durable async submissions and scoped keyboard behavior. Retain exact approval
   options, details, app identity and warnings; no invented permission scope.
5. **Content and media.** Keep native attachment variants through every mapper;
   centralize authorized image/asset URL resolution and expiry refresh. Integrate
   supported workspace media and provider rich output with Cozea's editor and
   artifact services. Unsupported kinds remain readable and explicitly unsupported,
   never silently reclassified. Keep GFM, tables, fenced code, copy and deferred
   highlighting. Do not replace the Markdown renderer or install a UI package
   merely to reproduce visual behavior.
6. **Presentation and performance.** Preserve the compact capsule composer,
   borderless/tight animated tool accordion, shared shimmer, no completed checkmark,
   and no active Working divider. Retain renderer-only grapheme reveal, one-shot
   entrance, canonical copy, reduced-motion and hidden-chat rules. Use memoized
   row subscriptions and incremental projections so text updates do not rebuild
   unrelated rows. LegendList remains the only scroll owner; preserve reading
   anchors through disclosure and history updates.

## Cozea invariants

- Independent Dockview tiles and provider instances; hidden Chat/Artifacts views
  retain controllers without replaying accumulated animation when shown.
- Project/workspace routing, native history associations, drafts/attachments,
  editor/file links, generated artifacts and DevApp/preview/MCP integrations.
- Existing provider controls, compaction, setup/recovery banners and opt-in
  update continuation. No renderer-generated duplicate continuation prompt.
- Stable recycled-row identity, keyboard/focus ownership and accessible status
  updates without announcing the whole response on every reveal frame.

## Acceptance and delivery

Create regression fixtures before replacing the corresponding paths. Replay
equivalent snapshot and live-event sequences for every enabled provider and
capability: commentary → tools → thinking → text → more tools → final; single-burst
and delta text; failures/stop/late chunks; approvals/questions; steering/restarts;
trailing/background tools; plan updates/reverts; reconnect; asset restoration.
Assert exact text, one terminal footer, correct phase/outcome, stable IDs and no
stale resurrection or cross-tile interaction.

Exercise Electron narrow/wide and simultaneous tiles, long histories, expanded
activity while reading older content, return-to-bottom, tile recycling, hidden
documents/Artifacts, reduced motion, media, request controls and copy. Profile a
long response for canonical updates as well as presentation frames. Use safe
fixtures; native-provider access/credit limits must be reported as unverified,
not silently claimed as tested.

Run focused and full tests, app/test typechecks (Electron/client checks when
affected), lint, build, and runtime/contract compatibility checks when affected.
Record unrelated failures separately. Update impacted docs and continuity and
deliver a reviewed diff plus an explicit covered/remaining acceptance matrix.
Do not mark the goal complete with known in-scope correctness gaps outstanding.

Review verification: 43 existing tests across eight focused files passed on
2026-09-05T01:12Z. Additional read-only probes reconfirmed plan/revert, attachment
mapping and tool-summary defects, and confirmed MCP approvals now survive. No
application source was changed during this handoff review. Existing Vite/Bun
configuration warnings remain; no new live-provider calls were made.

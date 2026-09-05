# Assistant text rendering

New assistant messages use a short, adaptive reveal before reaching the existing
Markdown renderer. Canonical provider text is stored immediately; display timing
never changes persisted content, provider state, approvals, or turn completion.
Typography and the existing Markdown renderer are retained. Turn projection,
provider task/plan rows, native attachments and tool presentation are described
below; the broader acceptance matrix is in `chat-rendering-refactor-progress.md`.

## Timing and ownership

Each mounted thread timeline owns a `TextRevealController`. Each assistant message
body subscribes to its own snapshot using `useSyncExternalStore`; presentation
frames do not update timeline state or rebuild the list's row data. The controller
retains progress across virtualized row recycling and drops removed messages.
Unmounting cancels its animation frame, and its registry is garbage collected.

The reveal uses elapsed animation-frame time at a baseline of 160 graphemes per
second, accelerating with backlog toward a 120ms delay. Arrival boundaries retain
their original `performance.now()` receipt times even when React batches events.
Any prefix at least 250ms old is released on the next available frame. Main-thread
stalls can delay that frame; this is a presentation budget, not a real-time browser
guarantee. No artificial delay is added before receiving text, and no frame loop
continues once the controller catches up.

Grapheme segmentation preserves known emoji sequences and combined characters.
Only the unrevealed suffix and preceding grapheme need segmentation on append.
Normal completion drains pending text. Interruptions, failures, disconnected or
stopped sessions, and authoritative replacements expose the received text at once.

## History and visibility

`messageTextArrival` attaches transient provenance through weak message-object
keys. Thread-detail ingestion distinguishes accepted snapshots and live updates;
neither JSON serialization nor backend contracts include these markers. Existing
messages at timeline attachment are the baseline and display immediately. An
asynchronously delivered snapshot also displays immediately, including any response
already streaming. Live additions after that baseline receive smoothing, including
new responses delivered in a single final event. Snapshot provenance is retained
when a snapshot and subsequent live tail arrive in one React batch.

Dockview visibility, the Chat/Artifacts toggle, document visibility, and the OS
reduced-motion preference control animation. Hidden views advance directly to the
received content; showing them again does not replay the backlog. A new live
message gets one 180ms opacity entrance on its first displayed text. Chunk updates
and recycled rows do not restart that entrance. Reduced motion disables both the
buffer and the CSS animation.

## Markdown, actions, and scrolling

The memoized assistant body passes displayed text into `ChatMarkdown` and keeps
its streaming mode enabled until both provider streaming and reveal have settled.
This postpones syntax highlighting until the code is ready, while retaining GFM,
tables, file links, and code-copy controls. Only the terminal assistant message
of a settled response receives actions. Those actions wait for reveal to
settle, appear after visible trailing tools, and copy canonical text. Existing runtime status and approval UI do not
wait for animation. The response is not an atomic live region announcing the full
text every frame.

LegendList still owns measurement, virtualization, near-bottom following, and
visible-position preservation. There is no additional scroll animation loop.
Completed folds with at most 24 child rows use the animated accordion. Larger
folds expose children as individually virtualized rows, keeping the original
IDs/order and a persistent accessible disclosure header. Large folds do not
animate a giant container height; newly visible children get the existing 180ms
fade once per timeline. Recycling or collapse/reopen never repeats it.

The active `Working` row at the bottom of a generating turn has no bottom divider.
Its shimmer and elapsed timer remain active outside tool or explicit Thinking
phases. Thinking replaces Working rather than adding a second status row.
Blocking questions or approvals show an input-waiting status and pause live
tool/Thinking/Working presentation. Async questions do not block generation.
Completed work uses a borderless animated turn disclosure, not a divider for
each assistant message.

`conversationProjection` owns native turn precedence, promptless response
continuity, terminal-message eligibility, compaction exceptions and fold
membership. `conversationRows` keeps expanded entries in chronological position,
including trailing work after final text. Tasks that outlive their launching
turn remain visible. A per-timeline incremental projector patches text and
attachment replacements without rebuilding unchanged turn/tool structure.
See `conversation-projection-performance.md` for measured scope and limitations.

The legacy full-read-model event path uses the same canonical detail reducer as
native thread streams. Finishing a commentary message or receiving a checkpoint
cannot settle a still-running turn. Shell/project metadata stays at the legacy
adapter boundary; native detail arrays use explicit loaded-snapshot authority.

## Native activity, requests and rich output

Provider task identity comes from native `taskId`; `agentId` identifies an owning
agent, not a Cozea tile. Child-owned tools/background work are retained in task
disclosures and excluded from parent tool totals. Nested agent spawn anchors
remain visible. Orphan/bypassed events have explicit presentation-only Activity
groups rather than disappearing or acquiring an invented task lifecycle. Owned
reasoning and plans cannot replace the parent's Thinking/plan state. Compact
secondary disclosures retain original event payloads, including failures.

Questions keep native option values, multi-select arrays and free-text policy.
Ordinary composer text/caret stay separate from pending answers; Enter follows
the same validation as Next/Submit. Async lost-ack retries retain their original
command identity and answer payload. Approvals retain the provider's choices,
app identity, warnings and native details.

Images/files keep their attachment variants. Signed media URLs share a cancellable
cache, refresh before expiry and retry failures; unknown variants stay explicitly
unsupported. Workspace Markdown media uses the existing authorized asset RPC.
Cozea's image gallery, file/editor routing and generated-artifact actions remain.

Codex file citations and artifact-template directives use the exact pinned pure
Markdown grammar through `packages/client-runtime/src/richOutput.ts`, including
mixed Markdown, escaping and entities. It uses the vendor's already-locked
dependencies (`bun run bootstrap` / `prepare:t3-runtime`); the production renderer
bundles the parser, with no runtime source-checkout dependency. Template cards
append a validated skill prompt to the existing ordinary draft and focus it;
they never install a skill, auto-submit, or overwrite a question response.
Copy actions intentionally retain canonical provider text.

Assistant quotations remain readable, including comments, but source navigation
is unavailable: Cozea has no environment/thread/range citation-target route.
Likewise native task IDs cannot safely be substituted for Cozea workbench tile IDs;
task inspection uses disclosures, not an invented native Agents-panel link.

## Connection lifecycle

Native shell/detail subscribers are refcounted and recreated with fresh tickets
after disconnect, using snapshot-first recovery, stale revision rejection and
capped retry delays. Transport errors never mean "use legacy"; only a successful
readiness response can choose that path. Legacy mode bootstraps a full snapshot
and replays later events. The command/config overlay is removed on disconnect;
commands are never automatically replayed.

One shared serialized bridge-status watcher per renderer checks every three
seconds while available, backing off failed/unavailable reads up to 30 seconds.
This detects restarted shadow endpoints without a timer per tile. Equal status
snapshots do not broadcast. Final subscription release cancels outstanding work
and stale callbacks cannot resurrect an old owner.

## Tool activity accordion

Tool groups use a plain, fixed-height 28px summary button, not a bordered or filled
pill. Counts use tabular numerals; keyboard focus and expansion remain available.
During a tool phase this summary replaces generic Working; an explicit provider
reasoning phase can take over with Thinking. Completed
actions contribute counts such as `Read 2 files, changed 1 file, and ran 1 command`;
before any action finishes the label is `Working`. Failures append `N actions failed`
(singular for one), without success checkmarks or failure badges.

The collapsed active summary uses the same `LiveShimmerText` as the sidebar.
Expanding removes its shimmer; only currently running action rows shimmer. The
group stays active between tool completion and the next assistant text message.
A subsequent message, turn completion, or interruption ends the presentation
phase but never changes the tool's reported outcome. Unfinished, stopped,
declined and failed actions remain distinct. Explicit older-turn entries and
session diagnostic notices do not take ownership of the busy indicator.

All lifecycle states stay inside one shared `Collapsible` with a 200ms height
transition. Expanded actions are single 24px lines with category icons and
truncated descriptions/full hover titles, not nested cards or payload blocks.
Existing changed-file diff and generated-artifact callbacks remain inline.
Reduced motion disables the height/chevron transition and sidebar shimmer.
The accordion is one measured LegendList row; expansion adds no scroll loop.
New summaries during live work fade in over 180ms, once per timeline row. A
timeline-owned seen-row set prevents replay after virtualization; initial rows,
hidden views, and reduced motion skip the entrance. Count changes do not restart
it. The effect supports React StrictMode's setup/cleanup/setup cycle.

Two identity fixes prevent avoidable jumping:

- Collapsed lifecycle entries retain a renderer-only `timelineOrigin` (first
  event ID and timestamp). Timeline ordering uses this anchor; row/group keys use
  native `(turnId, toolCallId)` when present, surviving completion-only snapshots.
  The entry's latest event ID, timestamp, status, and payload remain intact.
- LegendList treats `renderItem` as a React component. It now receives a stable
  module-level component and current rendering context, rather than an inline
  function that remounted rows whenever count data changed. This preserves DOM
  identity, focus, and measurements without changing the scroll controller.

Electron component QA at 768px/350px content widths verified the same button node,
28px height, and unchanged vertical position throughout 1→10 tool counts, with
one entrance per timeline (including StrictMode), no reduced-motion entrance,
transparent background/zero border, and keyboard expand/collapse retaining focus.
The accordion follow-up additionally verified animated expansion/collapse from
0→146→0px for six actions, fixed 24px action heights, collapsed versus expanded
shimmer ownership, completion→text state changes without replacing the summary
node, keyboard focus, and reduced-motion `transition-property: none`. Full
verification: 2,082 tests passed, four skipped; app/test typechecks, lint, and
production build passed. No renderer errors were captured. These are ephemeral
Electron renderer fixtures, not new provider runs or persisted conversations.

## Verification

Historical verification below describes the original reveal implementation.
The current refactor's tests, isolated Electron fixtures and remaining gates are
recorded separately in `chat-rendering-refactor-progress.md`.

### Text reveal coverage

Controller tests inject a clock and frame scheduler to cover bursts, pauses,
coalesced deadlines, completion, Unicode, snapshots, hidden views, replacements,
recycling, cleanup, and per-message notifications. Arrival tests cover transient
serialization boundaries, bounded receipts, and rejected stale snapshots. Rendered
QA should exercise wide and narrow tiles, Markdown completion and copy, scrolling
back through history, simultaneous responses, reduced motion, and hidden views.

Use the existing Bun test/typecheck/lint/build commands. Electron UI validation
requires the macOS runtime; if Docker is unavailable, use already-installed local
tooling without installing host packages.

### Implementation verification — 2026-09-05 (Asia/Kuala_Lumpur)

- Full Vitest run: 2,069 passed, four skipped. App typecheck, lint, production
  build, and diff whitespace checks passed.
- The initial test-only typecheck found the existing missing
  `patchT3ServerBundleProviderUpdates` declaration. The follow-up adds its signature
  to `scripts/prepare-t3-runtime.d.mts`; `bun run typecheck:tests` now passes.
- A temporary, non-persisted fixture in the running Electron renderer exercised
  the real timeline and Markdown components at 768px and 350px content widths,
  with 120 historical messages and simultaneous responses. Progressive reveal,
  single entrance, tables/lists/emphasis, file-link targets, canonical message
  copy, deferred code highlighting, and no horizontal overflow were verified.
- Bottom following settled at zero gap; reading history stayed at the same
  600px scroll offset through streamed growth. Hidden-chat and document-hidden
  catch-up, reduced motion, reconnect snapshots, and interruption flushing passed.
- A roughly 12KB response profile showed assistant-body renders around 5–7ms in
  the development build. Timeline fibers bailed out during reveal frames;
  the sibling timeline did no additional work after the canonical update.
- This was renderer-component QA, not a new paid provider run. Actual provider
  transport, native file-editor launching, and physical Dockview/Artifacts
  interactions were not re-exercised; their existing paths remain unchanged
  apart from the visibility prop. The temporary fixture was removed afterward.
- Divider follow-up: 33 focused status/runtime tests, both app and test typechecks,
  lint, and production build pass. Electron component QA confirms a 0px active
  border, advancing timer and shimmer, followed by a 1px completed border and no
  shimmer at both wide and narrow widths. No relevant renderer console errors.

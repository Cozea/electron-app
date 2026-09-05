# Conversation projection benchmark

Run `bun scripts/perf/conversation-projection.ts`. The harness warms each
scenario for 20 chunks and measures 50 subsequent canonical text updates.
Every update preserves historical message references and replaces only the
active assistant message. It verifies the fixture shape through fold/child
counts in its JSON output. Timing is informational, not a flaky CI gate.

This measures pure projection, row construction (including its own projection)
and row reuse. It does not measure the canonical reducer, React reconciliation,
DOM layout, Markdown, reveal frames, scrolling or Electron.

Observed on the existing macOS host with Bun 1.4.0, 2026-09-05:

| History entries | Many collapsed folds: build + reuse median / p95 ms | One expanded fold: build + reuse median / p95 ms |
| --- | --- | --- |
| 100 | 0.132 / 0.177 | 0.032 / 0.038 |
| 1,000 | 0.587 / 3.489 | 0.261 / 0.343 |
| 10,000 | 6.376 / 10.096 | 3.259 / 5.602 |

All unaffected top-level rows retained identity: 5,002 of 5,003 at 10,000
entries with many folds; four of five with one expanded fold holding 9,999
children. Reuse prevents unrelated row identity churn but still follows full
history reconstruction and recursive equality comparisons. These fixtures use
assistant text history; tool payloads and Markdown can add further costs.

## Incremental design

The implemented `createConversationRowProjector()` adds a conservative
text/attachment-only fast path. It scans entry identity/metadata, then patches
indexed message/footer row paths and their fold ancestors. All structural or
lifecycle changes fall back to the full builder. The harness reports its timing
and full-build count alongside the baseline.

A subsequent run during concurrent verification measured incremental medians
of 0.028 / 0.059 / 0.174 ms for 100 / 1,000 / 10,000 entries with many folds,
and 0.006 / 0.032 / 0.183 ms with one expanded fold. Each scenario performed
exactly one full build across the initial projection and 70 chunks. Same-run
10,000-entry baseline medians were 18.605 and 16.154 ms respectively; these
are substantially noisier than the earlier baseline, so do not treat
cross-run timings or speedup ratios as a release gate. Build-count regression
tests are deterministic.

The harness additionally runs the actual `deriveTimelineEntries` and
`mergeActivityEntries` pipeline, recreating every timeline wrapper around
stable historical message objects on each chunk. This is the more representative
variant for the current renderer. After optimizing metadata comparison for
unchanged canonical objects, its measured medians were:

| History entries | Many folds: incremental / derivation + incremental ms | Expanded fold: incremental / derivation + incremental ms |
| --- | --- | --- |
| 100 | 0.016 / 0.049 | 0.011 / 0.021 |
| 1,000 | 0.070 / 0.194 | 0.065 / 0.171 |
| 10,000 | 0.333 / 1.704 | 0.250 / 1.226 |

Each realistic scenario still performed only one full build. The 10,000-entry
inclusive p95 values were 8.751 and 10.232 ms on the busy verification host.
The original stable-wrapper results must not be presented as whole-pipeline
cost or as a DOM performance result.

Maintain indexes for entry identity, turn ownership, user response boundary,
terminal message and footer anchor. Cache each settled turn's fold and rows
using its canonical entry references and disclosure state. A text-only update
whose identity, turn, timestamp and streaming state remain unchanged should
replace the corresponding message row and preserve the settled turn caches.
Recompute the active response's terminal/footer/fold metadata only on structural
or lifecycle changes. Snapshot replacement/revert/history insertion invalidates
the affected suffix or resets the cache; same-ID replacements must still be
detected through entry reference/revision changes.

Keep disclosure state out of canonical indexing. Toggling a fold should
replace only that fold presentation record. Preserve LegendList identity and
the immutable row collection contract; caching rows alone does not eliminate
the cost of rebuilding the entire input array.

## Actual UI verification path

The existing `scripts/perf/interactions.mjs` harness connects to a running dev
Electron instance via CDP (`bun run dev:chrome-devtools`, then
`bun run perf:interactions`). Its React commit tracer and CDP CPU profiling
utilities are suitable for extending a safe fixture to text streaming, expanded
history, simultaneous chat tiles, hidden Chat/Artifacts and return-to-bottom.
Its current scenarios cover navigation, not those conversation cases. This
benchmark does not claim they were exercised.

## Rendered refactor verification — 2026-09-05

An isolated Electron fixture on this macOS host imported actual timeline,
Markdown, reveal, task and disclosure components. Two timelines with 100 history
messages each exercised canonical arrivals, presentation-only frames, expansion,
bottom-following and reading older history. The older reading anchor retained
pixel-identical positions while new text arrived; unrelated tile B had zero
commits during tile A's stream. Presentation-only commits excluded
`MessagesTimeline` and were approximately 0–2.2ms in the instrumented development
run. LegendList layout/position updates still occur, as expected.

Large completed folds previously mounted every hidden child in one list row.
The >24-child adaptation now keeps individual children virtualized. In the same
300-message fixture, mounted children fell from 300 to 32 (39 after scrolling),
latest expansion wall time from 487ms to 128ms, and largest React commit from
278.1ms to 26.9ms. These are noisy development measurements, not production
guarantees or CI thresholds. Ordinary folds retain their height transition;
large folds use one-shot visible-row opacity entrances instead. Reopen/recycle
regressions confirm existing children and tool summaries never fade again.

LegendList's existing DOM reorder runs after 500ms without position changes.
After settling, visual, DOM and accessibility order agree; a transient DOM-order
window during layout churn is a library limitation, not corrected with manual
DOM mutation or another scroll loop. A real footer-placement defect was fixed:
trailing folded activity now precedes terminal actions in both collapsed and
expanded states.

The full `CozeaChatSurface` was also mounted with actual Markdown/Lexical and
mocked controller/backend props for template, request and draft/caret checks.
Stable committed event callbacks and shallow-stable checkpoint maps avoid
broadcasting unchanged interaction metadata on text chunks. Superseded per-message
completion-summary derivation/props were removed from the hot path; the pure turn
projection is now the completion/fold owner.

Temporary evidence is under `/tmp/cozea-rendered-qa.gUx210/`: `stress-proof.json`,
`presentation-proof.json`, `large-proof.json`, `large-virtual-proof.json`,
`accessibility-proof.json`, `entrance-replay-proof.json`, and the corresponding
screenshots/scripts. Browser plugin was unavailable; existing bundled Playwright
used isolated Electron and Chromium, without installing dependencies or touching
real conversations. Actual OS hiding, live-provider transport, packaged-app
profiling and full Dockview integration remain unverified.

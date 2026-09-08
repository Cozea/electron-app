# D20 — Empirical qualification, tracing and model-limited performance

**Purpose:** prove that AID overhead and missing affordances are no longer the dominant controllable limitations. **Sources:** trace context/OpenTelemetry [S28](29-research-register.md#s28), benchmark methodology inspiration [S45](29-research-register.md#s45). Published benchmarks do not qualify this macOS implementation.

## 1. Three comparison modes

A: a known valid procedure executed directly against the native driver. B: the same procedure through the JavaScript SDK/host with identical cursor pacing, evidence requests and outcome predicates. C: the model plans and executes using AIDs from the same starting conditions. A versus B measures infrastructure tax for a fixed plan; C measures actual agent behavior. C minus B is not a pure numerical measure of intelligence because the selected plans and failure paths can differ.

Interleave trial order, reset fixture state, record cold/warm state, and pin hardware, OS build, application versions, display topology/refresh, input mode, provider/API/model configuration, tool schema and runtime commits. Never compare a cold debug run with a warm release run and attribute the difference to architecture.

## 2. Trace model

Use one task trace with child spans for host inference/wait, transport, JS evaluation/job pump, authority/queue wait, target validation, cursor plan/travel/presentation barrier, input dispatch, application wait, AX read, capture acquisition/freshness, encode and provider emission. Native signposts carry redacted operation IDs that correlate with host spans.

All elapsed intervals use the local monotonic clock; cross-process/remote clock mapping has error bounds. Trace context identifies causally related requests but does not synchronize clocks or authorize effects. Filter baggage. Record overlap and critical path, not a naive sum of concurrent tree/capture/encoding stages. Report absolute native overhead even when long application waits make percentages look small.

## 3. Fixture architecture

Build AppKit, WKWebView and Electron fixtures containing buttons with exact activation counters, editable fields/selection, scrolling, menus/sheets, dynamic labels/status counters, multiple windows, a drawing canvas with input samples, and controlled focus/geometry changes. The fixture separately records event receipt and resulting state/pixels. The agent still interacts through AIDs; no hidden fixture command bridge may complete the task.

A test controller can reset/inspect fixture state out of band as an oracle, but that oracle is unavailable to the agent and excluded from measured execution. Screen recordings for cursor alignment require consent and bounded retention. Add a high-contrast target/timestamp marker for comparing rendered hotspot, contact admission and app event receipt.

## 4. Required real tasks

Safari/YouTube: prepare foreground app, navigate/search, choose observed result, handle real player/ad controls, verify playback. A non-skippable ad is not a tool failure. Record model exchanges and actual UI decisions; a live site can vary, so pair with a deterministic fixture player.

Drawing: prepare a real drawing surface, test one stroke, then execute twenty arbitrary strokes under one spatial contract and verify visible marks. Notes is a named observed failure case, not assumed solved because another canvas works. Record actual target app/mode; text art or imported image is a different result in visible/physical validation.

Finder: start with no content window, prepare one, locate a specified test item, copy through actual UI, navigate/paste, verify destination. Inject status updates and capture sharing UI. Conflicting destination names require a decision within user instructions, not automatic Replace. Test data is disposable and isolated from user files.

Held-out tasks include unfamiliar table/forms, custom canvas editor, nested modal workflow and multimonitor window placement. Do not train the runtime around only the three motivating apps.

## 5. Initial quantitative targets

| Metric | Qualification target, not measured result |
| --- | --- |
| Warm JS-to-driver bridge | p95 <5 ms excluding queued ownership/AX/OS/application waits |
| Matched fixed-plan overhead B/A | <10% additional infrastructure critical-path time, also report absolute milliseconds |
| Cursor driver frame work | p95 <2 ms on qualified hardware; no deliberate blocking run-loop pump |
| Native stop admission | within one scheduled input tick; report actual bound |
| Owned-input cleanup | p95 <50 ms on controlled fixtures; OS delays/failures reported separately |
| Warm observation | initially p95 <450 ms for the defined fixture scope/resolution, not all applications |
| Capture continuity | same owned stream across60s without image requests under valid host liveness |
| Known navigation | shortcut/type/Return/observation in one model-facing execution |
| Twenty strokes | one program, initial/final requested images; local validation allowed |
| Ordinary actions | zero automatic full-tree traversals/image encodings |

Failure drives a documented experiment or narrowed qualification profile. Do not change the measurement or remove a test merely to make the target green.

## 6. Sampling and reporting

Use at least50 warm/cold samples for exploratory stage timing, 1,000 fixture action trials for release-tail estimates and larger samples where claiming rare failure rates. p99 from a tiny sample is not a robust tail estimate; always report sample count and estimator. Report p50/p95/p99 with confidence/bootstrap intervals where appropriate, maxima, cancellations and failed trials rather than deleting failures from timing data.

Zero observed wrong-window actions is a release requirement for the prescribed suite, not proof of zero possible failures. Include failure-rate confidence bounds and the environment envelope. For repeated binary success with zero failures, a rough upper bound scales with inverse trial count; do not call1,000 successes “guaranteed99.9% reliability.”

Resource metrics include CPU/GPU usage, memory high-water, retained pixel/artifact bytes, energy proxies where available, frame drops, AX calls, stream starts/stops, model tokens/exchanges and provider data exported. Slashing latency by recording every app at full rate is not an unqualified improvement.

## 7. Fault matrix

Inject cancellation before/after admission, during approach, after down, before up, during AX blocking, encode, checkpoint and provider response. Test worker/driver/host loss, heartbeat loss, sleeping/locked session, permissions revoked, disk full, malformed IPC, queue flooding, multiple writers, app/window/PID reuse, live status ticks, semantic label changes, new modal, resize/scroll/zoom, mixed-scale displays and unplug.

Every test checks both intended outcome and absence of extra effects. A clickcount1 expected and clickcount2 observed is a failure even if the app eventually reached the desired screen. Cleanup checks owned buttons/modifiers, pending samples, capture ownership, control epoch and journal certainty.

## 8. Build and test tiers

Tier0 validates docs/contracts/examples. Tier1 portable unit/property/model-state tests. Tier2 macOS native compile/unit/fixture binaries in debug/release and architectures. Tier3 packaged real Electron/driver/worker IPC and code-signing/TCC installation. Tier4 permissioned live input/capture plus provider image/checkpoint tests. Tier5 real/held-out task benchmarks and adversarial faults. Passing a lower tier never implies a higher one.

Use repo Bun commands and SwiftPM/macOS tools in the actual supported environment. Linux CI can run contract/state tests, not AppKit or TCC qualification. Intel cross-build is not Intel hardware evidence. Store qualification manifests beside CI artifacts with source/toolchain hashes and explicit skipped/blocked tests.

## 9. Deliverables and tests

Implement `tests/aid-system/fixtures`, `tests/aid-system/faults`, `scripts/benchmark-aids.mjs`, a trace-normalization tool and a machine-readable qualification report. Reuse existing `tests/computer-use` fixtures and native signposts rather than deleting them. Reports link evidence artifacts under access-controlled retention; public docs summarize results without private screen data.

**EVAL-01:** A/B plans have identical operation/evidence sequences. **EVAL-02:** overlaps are not double-counted. **EVAL-03:** failures remain in reports. **EVAL-04:** native/JS/model times are separated. **EVAL-05:** sample counts/environment are mandatory. **EVAL-06:** no hidden fixture route is available to the agent. **EVAL-07:** private trace content is redacted. **EVAL-08:** negative outcomes from Notes or unknown apps remain labelled. **EVAL-09:** budgets are versioned, not silently edited. **EVAL-10:** held-out task set is preserved. G09 gates performance claims only after correctness gates pass.

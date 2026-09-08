# D10 — Programmable conditions, event-driven attention and visual servo

**Purpose:** let code react to already-defined conditions at local speed, while reserving genuinely new interpretation for the model. **Sources:** AX and capture [S11–S15](29-research-register.md#s11); Apple Vision tracking [S35](29-research-register.md#s35). **Not claimed:** that arbitrary JavaScript can be compiled into a perfect incremental dependency graph, or that visual tracking guarantees semantic identity.

## 1. Two classes of watch

A declarative watch uses the SDK selector/condition AST, such as a uniquely named button becoming enabled within a known player region. The host can derive relevant scope subscriptions and perform targeted refreshes. An arbitrary predicate watch runs ordinary JavaScript in the worker with a bounded evidence snapshot and explicit reconciliation cadence. It has the same expressive power as code, but the host cannot infer all its dependencies reliably.

API: `aid.events.until(predicate, {scope, deadlineMs, pollMs?, stableForMs?})`. `predicate` executes in the guest. A declarative selector form can be passed to `watchQuery` for native dependency optimization. A watch returns current matching evidence/handles, not authorization to act forever. Every subsequent effect revalidates at dispatch.

## 2. Condition evaluation semantics

Evaluation receives one immutable evidence view and a cancellation signal. It must return falsy/no-match or a serializable value/valid target handle. No effectful SDK operation may run inside the predicate; this prevents one reconciliation from accidentally issuing several clicks. Actions happen in the program after the watch resolves or inside a separately declared reaction task whose effect scope is explicit.

`stableForMs` requires the condition to hold across a measured observation interval, not simply a sleep after one match. Timeouts report last observation, elapsed time, supported sources and coverage. A condition false in incomplete evidence is different from proven absence. The caller may request fuller evidence or a model checkpoint.

Each evaluation has an initial 10-ms compute slice; a predicate exceeding 100 ms of accumulated compute per evaluation fails `PREDICATE_BUDGET`. Host may authorize a larger pure-analysis profile. A malicious regex or loop cannot block the driver. Effects are denied in predicate mode even when the surrounding execution has input authority.

## 3. Scheduling and reconciliation

Each watch has scope generation, dependency set, last input/scene revisions, next eligible evaluation, deadline, last result and pending dirty reasons. Native events enqueue compact invalidations; event bursts are coalesced per scope. The event pump never invokes guest code on an AX/capture callback thread.

Known focus/destroy/geometry events preempt dependent effect admission immediately. Other dirty notifications schedule evaluation at most once per display/evidence batch. For sources without complete notifications, use bounded polling—initial 100 ms for an active narrow condition, 250 ms for weak AX scope, with backoff up to 1 second when idle. These are adjustable performance profiles, not universal app timings.

A watch may share a sensor subscription with another authorized watch. Memory/CPU ownership remains per control so one agent cannot consume all capture bandwidth. Capacity errors state which dimension is exhausted. Deadlines use monotonic clocks and include application waits, but distinguish active compute in metrics.

## 4. Expressive local procedures

A program can wait for a menu, inspect a deterministic result set, transform its geometry, and continue without model involvement. If the condition needs visual judgment not already expressed in code, call `aid.execution.decide` with selected evidence. There is no automatic hidden model called by `events.until`.

The model can author bounded reactions such as “while this dialog remains, monitor the progress field and return when it vanishes.” A newly appearing destructive confirmation is not permission to click its default button. Watches cannot escalate capability grants, follow arbitrary app switches, or continue beyond a revoked control episode.

Repeated observations need not all enter model context. The watch returns a compact receipt and the decisive evidence IDs; raw intermediate history exists only under the declared retention policy.

## 5. Visual-servo extension

Visual servo is an optional qualified local controller for a **previously grounded target**, not an alternative to semantic identity. A tracker receives a source observation, target region/landmarks, transform, expected motion envelope and an algorithm profile. It reports position, covariance/confidence, source time and tracking-loss reason. Apple Vision is a candidate tracker; profile behavior and coordinate conventions are qualified against recorded and live fixtures.

The controller may adjust a hover or follow path within a preauthorized spatial envelope. It must stop on low confidence, occlusion, source/window generation change, unexpected zoom/scroll, modal transition, focus loss or user takeover. Template resemblance cannot justify tracking an arbitrary new icon after the original disappears.

Use one latency budget across capture age, tracker compute, coordinate conversion, input scheduling and display presentation. Initial qualification uses maximum 50 ms evidence age and measured tracking error under a bounded velocity profile. Do not apply those defaults to every moving target. If the sensor is only 15 fps, a faster profile is unavailable until a higher-rate provider is qualified.

## 6. Controllers and cancellation

General controller code can compute desired motion in the worker and submit bounded future trajectories, but the high-frequency event timeline remains native. Maintain a short lookahead buffer, sequence numbers, validity interval and cancellation epoch. If samples arrive late, stop or reduce speed within the caller's declared tolerance; do not continue a stale path indefinitely.

No controller retains a pressed button while the model is deciding. Native gesture streaming may hold a button across local chunks in one execution only while its lease, watchdog and timing constraints remain valid. Missing chunks trigger a release and partial-effect receipt. D12 defines the motor semantics.

## 7. Implementation and evidence

Add host `WatchRegistry`, `PredicateScheduler`, `EvidenceSubscriptionBroker` and native narrow subscription adapters. Integrate with the worker's job queue and execution child scopes. Store a watch's declared dependency descriptor and redacted evaluation trace; do not log observed text by default.

**WATCH-01:** a button-enable event wakes a condition without a model call. **WATCH-02:** duplicate events cannot produce duplicate effects. **WATCH-03:** slow/throwing/infinite predicates cannot block stop. **WATCH-04:** missing AX notifications are reconciled and coverage is disclosed. **WATCH-05:** a vanished/ambiguous target does not resolve as a new lookalike. **WATCH-06:** all watches end or become inert when their execution/control ends. **WATCH-07:** steady-state unrelated updates do not trigger full-tree recapture. **SERVO-01:** track bounded motion with measured error/latency. **SERVO-02:** occlusion/identity loss stops before additional input. **SERVO-03:** late trajectory chunks release held state. Servo is an extension gate, not a blocker for basic condition watches.

## Initial tracker experiment

The first Apple Vision experiment uses object tracking seeded by the model/user-grounded rectangle and the exact source frame, with the accurate tracking profile where supported. Return the framework's actual confidence rather than inventing covariance; any additional uncertainty estimate is separately labelled and calibrated. Track source time, overlap, scale/translation envelope and independent window/anchor checks. Thresholds are selected from fixture/held-out false-match measurements, not an unexplained universal confidence constant. If the profile cannot distinguish target replacement/occlusion at the required error rate, it remains hover-only or unqualified for contact.

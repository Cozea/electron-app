# D01 — Baseline, evidence and architecture decisions

## Purpose and scope

This document prevents the implementation agent from inheriting the wrong constraints or promoting an attractive explanation into a fact. It identifies the existing Cozea seams, records the decisions already made, and defines what must remain measurable. Master invariants are in [MASTER](MASTER.md); detailed source links are in [D29](29-research-register.md).

## 1. Evidence ledger

**C01 — Source-confirmed baseline:** Cozea v2 at `8e65b729e47c0c1bdfdd8555f55f0338cc95223f` uses repo-owned Swift, a C ABI 2 bridge, Rust N-API and an authenticated Electron loopback broker. Primitive actions return small acknowledgements. Explicit observations collect AX and image work concurrently. These properties should be retained behind the new contracts.

**C02 — Capture lifetime:** `CaptureRuntime.release` starts a 15-second timer when active snapshot users reach zero; `expire` checks users but not the separately recorded session owners. Two-entry capacity eviction likewise selects entries with no current readers. This is a source-confirmed lifecycle problem, not evidence that ScreenCaptureKit inherently restarts after 15 seconds.

**C03 — Coordinate validity:** `CoordinateLeaseGuard` requires equality of both observed and input revisions and a maximum age. One input therefore prevents another coordinate action against that lease. Adding JavaScript alone cannot remove this restriction.

**C04 — Coherence veto:** observation collection retries once on changes and may publish incoherent evidence; action routing rejects that lease for all actions. The defect is the universal veto. The specific source of Finder's repeated AX notifications was not traced.

**C05 — Input routes:** click exposes AX/Sky/PID/global choices; drag and keyboard use PID delivery. The global click path already requires foreground and an explicit setting. Extend the consistent mode, not just the list of click method names.

**C06 — Cursor:** the renderer forces a procedural contour while using inherited hotspot/heading constants. User screenshots show an inverted, oversized-looking glyph. Geometry review finds a hotspot mismatch; a signed rendered calibration is still required. Do not repair artwork by flipping the application input coordinates.

**C07 — Window bootstrap:** target resolution selects an AX window before full CG matching and requires a running visible window. The tools cannot prepare an app independently of an observation. The reported sharing indicator is a reproduction target, not a justification to exclude every small window or dialog.

**C08 — Host protocol:** `ComputerUseRuntimeService.ts` validates settings/scheduled policy, uses 35-second calls and teardown barriers, and only accepts PNG/text content. The pinned raw T3 file uses 30-second backend calls and is patched from the native canonical tool catalogue. The new host must test the effective bundle and both deadline layers.

**U01 — User test report:** Notes PID strokes produced no marks; foreground global clicks reportedly produced dots. Safari reportedly took fourteen exchanges/about four minutes. Finder reportedly suffered bootstrap, sharing-window selection and incoherence loops. These are useful observations without a controlled comparison or correlated trace.

**U02 — Codex transcript:** describes a persistent JavaScript tool, explicit screenshots and local composition. Tool calls/results are omitted, most example workflows are declared simulations, and actual Notes drawing failed. It does not establish internal transport, private input quality, lifetime policy or universal speed superiority.

## 2. Claims explicitly not adopted

Do not encode the report’s “PencilKit rejects all PID events” explanation as an OS fact. Do not forward input to a WebKit child process just because the main-PID experiment failed. Do not label Sky unavailability a permissions problem when our own OS-range/environment/symbol checks may cause it. Do not treat depth 15/nodes 500 as larger than v2 defaults 64/1200. Do not infer task success from `observed_change` or assume its absence proves input failure.

The test report and transcript are private user materials. Their summarized observations belong here; raw screenshots, document names, conversation text and accounts do not belong in a public repository.

## 3. Decision record

| ADR | Decision | Rejected alternative | Consequence |
| --- | --- | --- | --- |
| ADR-01 | General-purpose programmable AIDs | Task-specific “cool action” catalogue | Native layer exposes devices; task algorithms live in model-written programs. |
| ADR-02 | Full JS module cells and live workspace namespaces | JSON batch with restricted syntax | Engine must support real language semantics and async jobs. |
| ADR-03 | Foreground public physical input plus semantic AX | Background-first dependence on private SPI | Physical pointer may move; human takeover is a first-class stop condition. |
| ADR-04 | Action-specific dependency validation | Global observation version as universal authority | More detailed target contracts, local evidence and faults are required. |
| ADR-05 | Owned, bounded capture | Snapshot-request idle expiry | Liveness belongs to control scope, not sensor demand. |
| ADR-06 | Separate pure memory from control authority | “Session” owning everything | Pure helpers may persist while all live privileges expire. |
| ADR-07 | Native timelines | JS timers or model calls per sample | Motor scheduling remains independent of guest and transport latency. |
| ADR-08 | Hotspot-origin cursor with adaptive pacing | Fixed 1.4-second choreography | Visibility is preserved without compulsory long travel. |
| ADR-09 | Journaled at-most-once admission with uncertainty | Universal exactly-once desktop transactions | Crash recovery may require observation instead of replay. |
| ADR-10 | Restricted worker and native peer boundary | `eval`/`node:vm` in Electron main | Isolation and packaging qualification precede production enablement. |
| ADR-11 | Protocol-neutral host with explicit IDs | MCP session owns the Mac | Transport reconnection cannot silently reset or grant devices. |
| ADR-12 | Same-model continuation checkpoints | Hidden model calls or restart-from-source | Live promises and single-use resume tokens are required. |
| ADR-13 | Source-qualified feature profiles | Assume latest platform docs equal installed support | Per-OS/app/provider qualification manifests gate behavior. |
| ADR-14 | Internal package seams, no public distribution choice | Premature npm/MCP packaging project | Keep extraction possible; solve Cozea first. |

## 4. Retain, refactor, remove

Retain tested geometry primitives, Unicode/key mapping knowledge, authorization-before-dispatch, cancellation registration, separate dispatch/observed clocks, raw AX formatting as an expansion option, ScreenCaptureKit identity binding, private-SPI isolation and native signposts.

Refactor `MacComputerRuntime` into driver services exposed by typed AID operations; `InputGate` into a seat permit bound to control epoch; `ObservationStore` into immutable evidence plus revalidatable handles; `CaptureRuntime` into owner-aware resource scheduling; and `ComputerUseRuntimeService` into a host adapter that keeps current product authorization but delegates workspace/execution state to `AidHost`.

Remove the blanket “get_app_state once per turn before anything,” unrelated-revision veto, automatic last-image invalidation after expected drawing, PNG-only host assumption, 15-second owned capture expiry and fixed PID-only device routes. Remove the old nine-tool surface only after the programmable route passes integration tests; a short development comparison adapter may exist but not a permanent alternate architecture.

Do not remove tests simply because the new design changes behavior. Rewrite the old stale-coordinate test into two explicit cases: ordinary unanchored screenshot points remain conservative; a qualified surface contract survives expected ink but not geometry change.

## 5. Repository reality that shapes the design

Cozea identifies installations by `identityKey` (`czd_…`), not email/user accounts. Bind AID records to the existing authenticated device principal and project/thread scope. Never authorize with avatar/display name or invent `userId` aliases. No Convex schema migration is necessary for the local AID core.

The current application is Electron plus a vendored T3 server and separate root/vendor Effect dependency trees. Do not unify or repin those trees as an incidental AID change. Add a protocol-neutral package and narrow adapters instead. The current renderer has established overlay portals and a single T3 webview host: AID supervision must use those conventions, not introduce a competing browser host.

Existing skills are locally managed with provider-native execution folders and binding metadata. The procedural-memory design integrates with that library rather than silently overwriting provider skills. Current agent kinds are provider adapters, not individual model names; a Gemini model does not automatically require a new top-level provider kind.

## 6. Empirical freeze protocol

Before implementing behavior changes, create a `baseline.json` with git SHA, native artifact hashes/ABI, Cozea build/signing identity, OS build, display layout/scales, target app versions, provider kind/version/model string, permissions and fixture versions. Capture both an application-visible result and a redacted timeline for each baseline failure. Preserve failures that cannot be reproduced as `not_reproduced`, not `fixed`.

Every subsequent trial identifies the same fields. An improvement claim requires matched procedures and presentation mode, not just a faster model, warm browser cache or a different task. Benchmarks and fault counts remain part of implementation artifacts, not prose claims.

## 7. Acceptance and work

**BASE-01:** a clean baseline run demonstrates that a call can return a compact receipt without capture. **BASE-02:** a fake-clock source test exposes owned-stream expiry at 15 seconds before the fix. **BASE-03:** coordinate reuse cases distinguish expected content from transform changes. **BASE-04:** the effective T3 catalogue is compared after the patch, not before. **BASE-05:** every user-reported scenario has an independent expected outcome and a limitation record. **BASE-06:** no private attachment is included in the docs or fixtures.

Work package W01 creates this ledger and fixture baseline; W02 freezes contracts; W35 removes development-only comparison shims after matched results. Any new discovery that contradicts an ADR is recorded before changing dependent code. Research gates [D30](30-qualification-gates.md) decide platform-sensitive alternatives; the implementation agent need not invent an architecture when an experiment fails.


## ADR-15 — Qualification baseline is not a legacy support promise

The first new environment qualification profile is **macOS26 on Apple silicon**, chosen as a concrete development/test baseline already used by the existing native CI lane, not as a claim that it is the newest OS. Cozea's former macOS14+/Intel build targets are historical context, not mandatory compatibility constraints for this redesign. Additional OS/architecture profiles—including newer releases—are enabled only after the relevant gates pass. Do not spend implementation effort on old compatibility paths merely to preserve v2 packaging. Do not claim a platform is supported because cross-compilation succeeds.

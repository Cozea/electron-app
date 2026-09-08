# Continuity

## 2026-09-08 — Programmable AID Environment reference architecture

Goal: build a freely programmable, visible macOS computer-use environment whose infrastructure does not force unnecessary model round trips or hide useful UI evidence. The model invents procedures; native general-purpose devices execute them faithfully.

Read in this order before AID work:

1. `docs/computer-use-aid-environment-design.md` — proposed reference architecture and empirical qualification contract. This develops and clarifies the earlier product definition.
2. `docs/computer-use-programmable-aids.md` — product goals and baseline failure report.
3. `docs/computer-use-current-platform-opportunities-2026-09.md` — technology research, not an implementation checklist.
4. `docs/computer-use-v2.md` — the merged v2 implementation baseline, not immutable future constraints.

Decisions clarified by the new design:

- Persistent JavaScript workspaces, active desktop control episodes, executions, operations, observations and MCP requests/tasks have different identities and lifetimes. Pure opted-in workspace memory may survive a human turn; capture/input authority must not silently survive it.
- JavaScript is a real resident programming environment with local conditions and same-agent decision checkpoints, not a disguised list of macros.
- Keep the real visible cursor, fix geometry/hotspot, and make pacing adaptive. A fixed 1.4-second approach is not a product invariant. Programmed held-button gestures preserve their path exactly.
- Foreground public input and semantic AX are the core routes; optional private SkyLight is not a universal reliability claim. One physical-input writer per login seat, with independent native stop/cleanup.
- Evidence is timestamped, scoped, queryable and optionally temporal. Related target/transform changes govern validity; unrelated activity is not a universal snapshot veto.
- Capture belongs to an active control scope, never merely to the most recent screenshot request. Resource pressure must not silently evict owned active capture.
- Stateless MCP does not make live Mac state portable. Tasks are capability-negotiated; cooperative protocol cancellation does not replace native revocation. A resumed checkpoint must never replay an effectful program prefix.
- Candidate QuickJS/Wasm/Wasmtime isolation is a qualification experiment, not a settled, working implementation. A separate restricted worker and typed device authority boundary are required irrespective of engine.
- Fixed-procedure native versus JS versus model-driven benchmarks separate infrastructure overhead from planning/grounding. Passing build/tests is not proof of signed-app GUI reliability.

State: documentation only. No AID runtime changes, tests, performance claims, PR merge or release were made by this design update. Main is unchanged. Design document was added in `88f4c3c39dd447ece6043a9693ea95ceb4300b72`.

Next: create measurable fixture baselines and qualify the native device/cursor/foreground/capture contract while prototyping the persistent JS boundary in parallel. Preserve the three real Safari, drawing and Finder tests and add held-out unfamiliar UI tasks. Record every remaining platform limit explicitly.

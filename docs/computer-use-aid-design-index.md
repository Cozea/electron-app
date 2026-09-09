# AID system design index

Start with [MASTER](aid-system/MASTER.md), [HANDOFF](aid-system/HANDOFF.md) and [DESIGN-REVIEW](aid-system/DESIGN-REVIEW.md). Branch: `feat/programmable-aids-runtime`. The recovered 27 subsystem designs are retained; D28–D31 and contracts are newly completed/reconciled support. Runtime qualification remains unrun.

| Document | Purpose |
|---|---|
| [01](aid-system/01-baseline-decisions.md) | D01 — Baseline, evidence and architecture decisions |
| [02](aid-system/02-contracts-sdk.md) | D02 — Canonical contracts, SDK and progressive discovery |
| [03](aid-system/03-javascript-workspaces.md) | D03 — Persistent JavaScript workspaces and execution semantics |
| [04](aid-system/04-isolation-processes.md) | D04 — Execution isolation, processes and local IPC |
| [05](aid-system/05-lifecycle-authority.md) | D05 — Lifetimes, authority, seat ownership and liveness |
| [06](aid-system/06-continuations-checkpoints.md) | D06 — Same-model decisions, human approvals, and resumable continuations |
| [07](aid-system/07-evidence-scene.md) | D07 — Queryable evidence service and scene representation |
| [08](aid-system/08-accessibility.md) | D08 — Accessibility acquisition, identity and incremental reconciliation |
| [09](aid-system/09-capture-artifacts.md) | D09 — Turn-owned capture, frame freshness and artifact transport |
| [10](aid-system/10-watches-servo.md) | D10 — Programmable conditions, event-driven attention and visual servo |
| [11](aid-system/11-spatial-validity.md) | D11 — Coordinate frames, target dependencies and stable surfaces |
| [12](aid-system/12-motor-timelines.md) | D12 — Native motor kernel, pointer primitives and coordinated timelines |
| [13](aid-system/13-keyboard-clipboard.md) | D13 — Text, physical keys, composition and explicit clipboard use |
| [14](aid-system/14-cursor-presentation.md) | D14 — Truthful pointer presentation, hotspot geometry and pacing |
| [15](aid-system/15-apps-windows-backends.md) | D15 — Application preparation, window targeting and qualified input routes |
| [16](aid-system/16-journal-recovery.md) | D16 — Execution journal, delivery certainty and crash recovery |
| [17](aid-system/17-host-provider-protocol.md) | D17 — Cozea host, provider adapters and stateless protocol integration |
| [18](aid-system/18-human-supervision.md) | D18 — Human supervision, truthful feedback and immediate takeover |
| [19](aid-system/19-security-privacy.md) | D19 — Threat model, authority confinement and evidence privacy |
| [20](aid-system/20-evaluation.md) | D20 — Empirical qualification, tracing and model-limited performance |
| [21](aid-system/21-procedural-memory.md) | D21 — Agent-authored skill modules and procedural memory |
| [22](aid-system/22-pipelined-planning.md) | D22 — Pipelined perception and planning without conflicting writers |
| [23](aid-system/23-debugger-replay.md) | D23 — Execution debugger, safe inspection and recorded simulation |
| [24](aid-system/24-demonstrations.md) | D24 — Human demonstrations as evidence for program synthesis |
| [25](aid-system/25-separate-seats.md) | D25 — Independent agent desktops and remote seat routing |
| [26](aid-system/26-extended-devices.md) | D26 — Pen, touch and hardware-backed device providers |
| [27](aid-system/27-integration-packaging.md) | D27 — Concrete Cozea integration, source ownership and packaging seams |
| [28](aid-system/28-implementation-roadmap.md) | D28 — Dependency-ordered implementation roadmap |
| [29](aid-system/29-research-register.md) | D29 — Primary research register and adoption boundaries |
| [30](aid-system/30-qualification-gates.md) | D30 — Qualification gates and evidence contracts |
| [31](aid-system/31-design-reconciliation.md) | D31 — Final cross-subsystem decisions and consistency resolutions |

[Contract artifacts](aid-system/contracts/README.md) provide schemas, declarations, examples, work packages and traceability. The [historical publication audit](computer-use-aid-design-publication.json) records the earlier recovery only. Current validation/export reports identify their checked commit and file hashes; the old recovery counts do not describe current validation.

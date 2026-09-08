# Expanded AID design corpus

Branch: `feat/programmable-aids-runtime`. Recovered from the prior completed design-tree writes; this is documentation, not an implemented runtime.

Start with the master/system specification in the table below, then shared contracts and the implementation sequence. Earlier reference documents remain historical context; subsystem qualification gates are not claims of working integration.

| Design document | Words |
|---|---:|
| [D01 — Baseline, evidence and architecture decisions](aid-system/01-baseline-decisions.md) | 1616 |
| [D02 — Canonical contracts, SDK and progressive discovery](aid-system/02-contracts-sdk.md) | 1507 |
| [D03 — Persistent JavaScript workspaces and execution semantics](aid-system/03-javascript-workspaces.md) | 1563 |
| [D04 — Execution isolation, processes and local IPC](aid-system/04-isolation-processes.md) | 1319 |
| [D05 — Lifetimes, authority, seat ownership and liveness](aid-system/05-lifecycle-authority.md) | 1393 |
| [D06 — Same-model decisions, human approvals, and resumable continuations](aid-system/06-continuations-checkpoints.md) | 1360 |
| [D07 — Queryable evidence service and scene representation](aid-system/07-evidence-scene.md) | 1188 |
| [D08 — Accessibility acquisition, identity and incremental reconciliation](aid-system/08-accessibility.md) | 1163 |
| [D09 — Turn-owned capture, frame freshness and artifact transport](aid-system/09-capture-artifacts.md) | 1330 |
| [D10 — Programmable conditions, event-driven attention and visual servo](aid-system/10-watches-servo.md) | 1122 |
| [D11 — Coordinate frames, target dependencies and stable surfaces](aid-system/11-spatial-validity.md) | 1133 |
| [D12 — Native motor kernel, pointer primitives and coordinated timelines](aid-system/12-motor-timelines.md) | 1159 |
| [D13 — Text, physical keys, composition and explicit clipboard use](aid-system/13-keyboard-clipboard.md) | 1082 |
| [D14 — Truthful pointer presentation, hotspot geometry and pacing](aid-system/14-cursor-presentation.md) | 1060 |
| [D15 — Application preparation, window targeting and qualified input routes](aid-system/15-apps-windows-backends.md) | 1030 |
| [D16 — Execution journal, delivery certainty and crash recovery](aid-system/16-journal-recovery.md) | 1136 |
| [D17 — Cozea host, provider adapters and stateless protocol integration](aid-system/17-host-provider-protocol.md) | 1165 |
| [D18 — Human supervision, truthful feedback and immediate takeover](aid-system/18-human-supervision.md) | 918 |
| [D19 — Threat model, authority confinement and evidence privacy](aid-system/19-security-privacy.md) | 977 |
| [D20 — Empirical qualification, tracing and model-limited performance](aid-system/20-evaluation.md) | 1200 |
| [D21 — Agent-authored skill modules and procedural memory](aid-system/21-procedural-memory.md) | 697 |
| [D22 — Pipelined perception and planning without conflicting writers](aid-system/22-pipelined-planning.md) | 784 |
| [D23 — Execution debugger, safe inspection and recorded simulation](aid-system/23-debugger-replay.md) | 772 |
| [D24 — Human demonstrations as evidence for program synthesis](aid-system/24-demonstrations.md) | 698 |
| [D25 — Independent agent desktops and remote seat routing](aid-system/25-separate-seats.md) | 845 |
| [D26 — Pen, touch and hardware-backed device providers](aid-system/26-extended-devices.md) | 649 |
| [D27 — Concrete Cozea integration, source ownership and packaging seams](aid-system/27-integration-packaging.md) | 1115 |
| [Cozea AID Environment — master system design](aid-system/MASTER.md) | 2525 |

## Verification boundary

Blob hashes and the documentation-only delta were checked before publication. This recovery does not claim runtime compilation, macOS permissioned tests, provider compatibility, or measured latency. Published/draft protocol and OS feature support must pass the qualification gates in the design; an HTTP/source link alone is not proof of implementation support.

Relative-link findings: 69. See [publication audit](computer-use-aid-design-publication.json).

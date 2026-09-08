# Navigation runtime repair status

This branch is **not accepted or complete**. The earlier completion report is withdrawn.
The reviewed Electron/performance runner only printed success; its exits were not
application or performance evidence. The state-only retention tests did not prove
that React or Dockview instances survive a route departure.

Repairs are being made against `deb92d01c83e323680ff7ff5443ac69c248a537b` on
`perf/navigation-runtime-v2-repair`. The original handoff and review remain the
acceptance contract. Unit, compilation, integration, production timing and
platform-specific checks must be recorded separately for the exact candidate SHA.
No unexecuted check is passed. Do not merge until the mandatory gates are resolved.

First repair set: actual persistence worker transport, validated migration domains,
real legacy envelopes, failed-import propagation, atomic record replacement,
explicit operation-watermark acknowledgements and restoration-safe read failures.
These changes require CI and lifecycle integration before acceptance.

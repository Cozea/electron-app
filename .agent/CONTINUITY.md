# Continuity

## Expanded programmable AID system design

Read `docs/computer-use-aid-design-index.md` first. It links the recovered master and individual subsystem specifications. The product is programmable general-purpose visible AIDs, not native task macros. Persistent JavaScript, explicit control epochs, truthful cursor/gestures, scoped evidence, capture ownership, native revocation, journaled uncertainty and no effect-prefix replay are core requirements.

State: design corpus published; runtime implementation and live qualification have not been performed by this documentation change. Use the subsystem work packages and qualification gates. Do not treat research opportunities or target budgets as demonstrated platform behavior. Main is unchanged.

## [PLANS]
- 2026-09-09T03:58Z [USER] Complete documentation-only reconciliation and verified export on `feat/programmable-aids-runtime`; preserve general programmable AIDs. No runtime implementation, main merge or release.
## [DISCOVERIES]
- 2026-09-09T03:58Z [TOOL] Remote and local checkpoint is `bd3f1ea2b29475312c3bf7a1f840a554788bb2a6`; failed run 34249062538 is readable. Its generated examples could not resolve `aid:runtime`; blanket citation rewriting created nonexistent D anchors.
- 2026-09-09T03:58Z [CODE] `prepare.py` and `finalize_design.py` generate incompatible APIs, W/G mappings and states. D28 owns W01–W35/X01–X06; D30 owns G01–G12. The checked-in SDK is older than both later host schemas. Clipboard atomic restoration and post-preparation journal ordering need actual corrections.
## [DECISIONS]
- 2026-09-09T03:58Z [CODE] Consolidate contract generation and verification; retain D28/D30 numbering, preserve all old negative-test intent, repair citations by supported topic, and update owning prose rather than stacking override notices.

## [OUTCOMES]
- 2026-09-09T03:24Z [CODE] Complete owners reconciled; one normalized `contract-source.json` and `tools/design.py`; 78 guest methods, explicit observation records, host/result schemas, 41 work packages and 259 named acceptance requirements. Old generators delegate; old D31 redirects. Original 27 subsystem designs and X01–X06 ambitions retained.
- 2026-09-09T03:24Z [TOOL] Eight local documentation suites passed before final commit preparation: 67 vectors, 21 model/retention tests, TypeScript/AST coverage, links/graphs/inventory/read-only checks. Root app typecheck could not run because app dependencies/tsc are absent; isolated design types passed. Source-retrieval metadata records 90/92 responses; two stale URLs were replaced with applicable primary sources. Native gates G01–G12 remain not_run.
- 2026-09-09T03:24Z [PLAN] Commit/push this documentation-only completion without force, validate/read back exact branch commit, and export clean committed sources with per-file hashes. Handoff manifest supplies the final commit identity. No runtime implementation, main merge or release.

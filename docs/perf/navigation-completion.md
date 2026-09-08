# Navigation runtime repair — validation ledger

Status: **Implementation in progress; not approved for merge.**

The earlier completion report at `deb92d01c83e323680ff7ff5443ac69c248a537b` is withdrawn. Its Electron/performance passes were based on a runner that only inspected fixture descriptions and printed success. Those exits are not integration or performance evidence. The presentation-store tests do not prove React or Dockview instance retention.

## Verified starting evidence

- Original audited baseline: `073df5230d2400684434ea6b7db27b0aafc72ddc`.
- Reviewed incomplete implementation: `deb92d01c83e323680ff7ff5443ac69c248a537b`.
- Repair branch: `fix/navigation-runtime-v2-completion`.
- Current main also contains the independently merged computer-use implementation `8e65b729e47c0c1bdfdd8555f55f0338cc95223f`; the repair must preserve it.
- GitHub Actions run `34213996099` executed the existing navigation Node unit tests successfully. This is only evidence for those unit tests, not the application behavior claimed by their names.
- Independent source review reproduced wrong legacy envelope imports and false-positive runner success. Repairs and regression tests are required before using migration on valuable userData.

## Mandatory remaining gates

1. Correct schema-aware migration, hydration ordering, revisions, and flush failure handling.
2. Trusted IPC validation and a real dedicated persistence worker.
3. One integrated persistent shell/host, concrete session identity, guarded activation, and scoped context ownership.
4. Capture-gated eviction and visibility lifecycle without stopping independent services.
5. Real Electron route-return tests, instance counters, delayed-operation tests, and production-build timing samples.
6. Typechecks, lint, relevant unit/integration tests, cleanup of competing paths, and review-bot feedback.

Until actual evidence is recorded, all mandatory integration/performance scenarios remain **not run**, and source-only claims remain **unverified**. The acceptance matrix describes required scenarios; a pre-existing `passed` field without a recorded runner/artifact must not be treated as evidence.

No production deployment, destructive profile reset, or automatic merge is authorized by this ledger. Replace this document with measured results and explicit blocked gates as implementation proceeds; never substitute console messages or fixture counts for test execution.

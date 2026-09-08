# AID design work log — 2026-09-08

## Requested deliverable

Expand the reference architecture into an extensively researched master design, individual subsystem implementation designs, shared contracts, work packages and empirical acceptance tests. Preserve the work on `feat/programmable-aids-runtime`; do not implement, merge or release runtime changes as part of this documentation task.

## Recovery source

The prior pass wrote the expanded corpus into Git tree `aee58b086421196d712e2edc9755637686cef738`, relative to base tree `a744dfda163871c4623822dec452c482b49f041f` and branch commit `b8852de1b7372269f2dd2ee0308be564c7fc00a6`. These are real returned Git object identifiers from that pass. The branch had not been advanced to those objects at the last readable checkpoint.

The one-shot `.github/workflows/recover-aid-design-documents.yml` is intended to recover only the documentation delta, verify blob hashes, reject concurrent edits, publish an index/audit, advance the feature branch without force, and delete itself. Its resulting `docs/computer-use-aid-design-publication.json` is the authoritative machine-readable publication record if present. A failed workflow must not be described as a successful publication.

## Additional authored review

`docs/computer-use-aid-design-implementation-clarifications.md` specifies cross-subsystem constraints: identity versus authority; control versus workspace lifetime; actual persistent JS cell semantics; safe continuations; app/window bootstrap; coordinate units; surface validity; capture owner/borrower races; delivery uncertainty; native scheduling; artifact/journal contracts; privacy and containment; and qualification of advanced devices and separate seats.

## Verification limits

Tool outputs stopped being readable during this recovery pass. Publication/read requests and local recovery/export/audit scripts were issued, but the assistant must not claim a final verified branch SHA, semantic source review, passing document link check or implementation-ready status without reading their results. The local audit deliberately distinguishes source availability and keyword coverage from semantic review, and does not claim runtime tests.

Before handing this corpus to an implementation agent, read the publication audit, inspect all recovered subsystem documents, repair unresolved relative links, reconcile shared schemas/units/state transitions and qualify current platform claims against primary documentation. The task requires real research and coherent implementation contracts, not just a large number of files. Do not discard the existing draft work or start from an empty directory.

Main and release behavior are outside the scope of this task. The native runtime, pinned T3 gitlink and production data must remain unchanged by this documentation publication.

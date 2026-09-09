# AID implementation handoff

The design completion preserves the original programmable-device objective and the 27 subsystem specifications. Read [MASTER](MASTER.md), [D31](31-design-reconciliation.md), [D02](02-contracts-sdk.md), [D28](28-implementation-roadmap.md), [D30](30-qualification-gates.md), then the owner documents for your work package. [DESIGN-REVIEW](DESIGN-REVIEW.md) records corrected contradictions and complete failure traces. [D29](29-research-register.md) records primary evidence and adoption limits.

Use `contracts/contract-source.json` as the design contract input. Generate documentation artifacts with `python docs/aid-system/tools/design.py generate`; run the read-only audit with `python docs/aid-system/tools/design.py check --report /tmp/aid-validation.json`. Do not edit generated declarations or schema copies. Production W03 emits the actual cross-language method codecs and routers; the documentation tooling does not implement desktop operations.

Validation requires Python 3.12 with jsonschema 4.23.0, Bun 1.2.22 and TypeScript 5.6.3. `AID_BUN` selects Bun and `AID_TYPESCRIPT_ROOT` selects the installed TypeScript package directory. Install tools in an isolated environment; the workflow shows the pinned setup. The package manager for this repository remains Bun. No root dependency or runtime file was changed to validate these documents.

Start with W01's preserved evidence, then W02/W03 contracts and W04/W05 signed topology/engine qualification. Follow the generated dependency graph rather than assuming W-number order. W29 requires W32's packaged bundle. Preserve X01–X06; optional features cannot be claimed available before their G10–G12 experiments.

The runtime remains unimplemented and all G01–G12 status records are `not_run`. Feasibility failures follow D30's explicit fallback/stop rules and require an ADR for changed design decisions. Do not replace rich JavaScript with task macros, discard visible native interaction, reintroduce screenshot-per-stroke orchestration, or replay effects to reconstruct a continuation.

For a verified export, commit the checked sources, use a clean checkout, and run `python docs/aid-system/tools/design.py export --out /tmp/aid-handoff`. The exporter rechecks the sources, compares every file with the committed tree, reopens the ZIP, verifies hashes and verifies the consolidated reading edition. Its manifest and validation JSON identify the exact source commit. A workflow that only creates an archive is not design acceptance.

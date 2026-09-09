# Authoritative AID design contracts

Application revision **1.1**. These are implementation inputs and conformance oracles, not a production runtime. [D02](../02-contracts-sdk.md) defines the guest/wire codecs and closed native dispatch requirement. [D31](../31-design-reconciliation.md) defines cross-system semantics. The design preserves named ES-module cells, explicit exports, native device composition, visible interaction and single-use live checkpoints.

| File | Role |
|---|---|
| [contract-source.json](contract-source.json) | Authoritative guest declarations, wire definitions, method metadata, state graphs and work/gate mappings |
| [aid-sdk.d.ts](aid-sdk.d.ts) | Generated rich guest SDK plus schema-derived `Wire*`, `HostRequest`, `HostResult` and `HostApi` types |
| [host.schema.json](host.schema.json) | Generated six-method request envelope; `aid-wire.schema.json` contains identical bytes for compatibility |
| [values.schema.json](values.schema.json) | Framed wire geometry, receipts, errors, checkpoints and native envelope framing |
| [results.schema.json](results.schema.json) | Host result/emission/status schemas; waiting states and evidence requirements |
| [qualification.schema.json](qualification.schema.json) | Implementation-gate evidence record; no empty test set can claim passage |
| [conformance-vectors.json](conformance-vectors.json) | Independently curated positive and negative schema/semantic fixtures |
| [state-machines.json](state-machines.json) | Generated execution/control/checkpoint/capture graphs |
| [method-catalogue.json](method-catalogue.json) | 78 guest signatures with minimum effect/capability/cancellation metadata |
| [work-packages.json](work-packages.json) | W01–W35/X01–X06 graph, checked against actual D28 prerequisites |
| [traceability.json](traceability.json) | Owning subsystem requirements, work packages, contracts and qualification gates |
| [requirement-traceability.json](requirement-traceability.json) | Each named acceptance requirement, exact criterion, contract types, implementation test ID, packages and gates |
| [qualification-status.json](qualification-status.json) | All twelve runtime gates start `not_run` |
| [research-reference-map.json](research-reference-map.json) | Topic-based correction of recovered citation numbering |
| [examples](examples/navigation.ts) | Compiled navigation, drawing, checkpoint, watch and negative examples |

Run `python docs/aid-system/tools/design.py generate` after intentionally editing the source contract. Generation never edits subsystem prose or fixtures. Run `python docs/aid-system/tools/design.py check --report /tmp/aid-validation.json` to check drift, references, dependencies, schemas, semantics, bounded models, TypeScript and inventory. Check mode does not modify repository inputs. See [HANDOFF](../HANDOFF.md) for isolated toolchain versions.

The TypeScript compiler uses [tsconfig.json](tsconfig.json) to resolve `aid:runtime` and the example `workspace:/geometry` module. Negative examples use consumed `@ts-expect-error` directives; an unused directive fails the build. A TypeScript union cannot express all JSON refinements: native admission also checks unknown fields, one-of exclusivity, finite/range limits, UInt64 counters, evidence relationships, owner, epoch and current targets.

`Wire*` types are serialized records; rich guest proxies are local objects with methods. Their codecs are explicitly prescribed in D02. The native envelope is framing, **not** permission to accept arbitrary `arguments` objects. W03 must generate typed method validators/routers and cross-language fixtures before exposing a driver operation.

All old generation entry points delegate to one pipeline. They no longer normalize citations to fabricated anchors, renumber roadmap packages, replace the SDK, mutate source documents or assert completion. The single GitHub validation workflow checks its triggering commit and exports only a clean, source-matching tree. No validation workflow commits to the branch.

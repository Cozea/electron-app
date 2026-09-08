# AID contract artifacts — design revision 1.1

These files are implementation inputs and conformance oracles. They are **not** a working AID runtime, generated production SDK or permissioned native test result. Public npm/MCP distribution remains deferred.

Read [D02](../02-contracts-sdk.md), [D03](../03-javascript-workspaces.md), [D05](../05-lifecycle-authority.md), [D06](../06-continuations-checkpoints.md), [D16](../16-journal-recovery.md) and [D31](../31-cross-system-review.md) with these artifacts. In implementation, W02/W03 turn the frozen surface into a single IDL that generates SDK, Swift/worker wire types, validators and progressive documentation. Do not maintain independent producer/consumer schema copies.

## Files and ownership

| Artifact | Owns |
|---|---|
| [aid-sdk.d.ts](aid-sdk.d.ts) | Typed outer host API, persistent guest device/resource surface and effect-result vocabulary |
| [aid-wire.schema.json](aid-wire.schema.json) | Exact outer request branches, receipt invariants and execution/checkpoint result envelopes |
| `method-catalogue.json` | Method dispatch layer, effect class and minimum capability; emitted by design tooling |
| `work-packages.json` | W01–W35/X01–X06 dependency graph and subsystem ownership |
| `qualification-status.json` | Initial not-run status of all twelve platform/extension gates |
| `wire-vectors.json` | Positive and negative schema examples, including forged principal and mixed close targets |
| `state-model-vectors.json` | Authority, capture, continuation and recovery counterexamples |
| `traceability.json` | Preserved requirement IDs to owning documents, work packages and qualification gates |
| `examples/` | Complete typechecked illustrative module cells, not live execution claims |
| `validate.py` | Reproducible documentation/schema/model checks; does not control the computer |
| `prepare.py` | Deterministic derived test artifacts and metadata; does not create production packages |

The documentation preparation command is allowed to generate these design artifacts. The validation command is read-only except for an explicitly selected report/output directory. Repeated preparation must be deterministic and preserve the recovered subsystem content. A missing prerequisite is a failure, never a zero-document success.

## Public requests versus trusted context

The outer API accepts `open`, `exec`, `inspect`, `respond`, `close`, `describe`. The model sees the corresponding `computer_*` tool names. Neither the schema nor SDK accepts a model-selected principal, provider instance, approval role or raw native pointer. The trusted host associates the request with the real Cozea device/project/thread/provider context and passes an internal authenticated envelope to the driver.

A request ID is correlation. An execution idempotency key binds the owner, code/source hash, cell identity and frozen import revisions. IDs do not confer capability. `controlId` locates an authority record; the native boundary checks current runtime/epoch/grants independently.

`respond` contains a response value, not an authority claim. Its value is checked against the stored checkpoint schema. A model tool may answer a model-decision checkpoint only. A human-approval checkpoint requires the separate trusted human UI channel and a current effect/dependency fingerprint. This cannot be expressed by adding a `human: true` flag.

## Exact application and target semantics

`apps.get` and `apps.list` are read-only. `apps.prepare({app, launch, unhide, reopen, foreground, window})` performs explicitly requested mutations and sets an execution keyboard target only after verifying the intended foreground result. A request identifies an app by exactly one of bundle identifier, running PID or name; ambiguous resolution fails.

`Window.query` performs a scoped live query. `Observation.query` reads that immutable observation. The latter must not silently contact AX. Query selectors remain data: literal filters may execute natively; a guest `RegExp` or arbitrary predicate executes in a bounded read-only guest scope over returned evidence. Do not send unbounded guest regex code into an AppKit/input callback.

`ElementSelection.one()` rejects zero, multiple or incompletely established unique matches. The agent can deliberately choose an observed item from `items`, but the convenience method cannot quietly choose the first result. Every later effect still revalidates the chosen handle's identity, semantics and relevant geometry.

## Coordinate contract

A `Point` contains frame identity and transform generation. Bare numeric pairs are accepted only by the already-bound `Surface.pointer` facade, where they are normalized coordinates of that surface. The native validator checks finite values, actual containment and allowed transform. It does not clamp out-of-range points silently.

An observation image has a pixel frame, source frame, crop/scale metadata and provenance. A window-local point is not a screenshot pixel. A surface point is not a desktop point. Mixed frames are converted only through the driver's known topology and a permitted operation; otherwise reject them. Negative desktop origins are legitimate where the named frame permits them.

The d.ts describes types, not every numerical refinement. Runtime validation still rejects non-finite numbers, unsafe counters, UInt64 overflow, invalid geometry, malformed UTF-8, unpaired-surrogate strings where canonicalization requires Unicode validity, duplicate JSON keys and excessive resource sizes. JSON Schema alone does not perform native authority, target liveness or application outcome verification.

## Persistence and complete examples

The execution environment evaluates named ES-module cells. A successful cell publishes explicit exports; later cells import the resident namespace through `workspace:/name`. Non-exported lexical variables are not implicit global REPL bindings. Reusing an idempotency key does not reevaluate the cell. A new key deliberately does.

Examples have the following meanings:

- `geometry.mjs` is a pure exported helper; its source does not draw anything.
- `navigation.mjs` prepares a real foreground browser, sends known input and emits one requested observation.
- `drawing.mjs` binds an actually observed fixture canvas, checks required geometry, sends twenty strokes and emits final evidence. It is not a claim that Notes input already works.
- `checkpoint.mjs` suspends for the same controlling model and resumes without replaying its prefix.
- `negative.ts` contains intentional type errors for unframed points, invalid key input, missing app queries and forged owner fields. An unused expected error fails the typecheck.

The examples must compile against this declaration file. Running them on a real desktop requires the future qualified runtime, valid grants and an actual target. No mock in the documentation bundle is presented as successful GUI behavior.

## Results, failure and retry

A receipt separates submission, observation evidence and outcome. `submission_uncertain` forbids automatic replay. `no_change_observed` is not `failed`. A verified/failed outcome references a concrete verification predicate and actual evidence; a changed pixel region does not automatically prove the user's entire objective.

The schema makes a completed execution quiescent and prohibits a pending checkpoint on that completed result. A waiting model/human execution contains the correct checkpoint kind and no held input. Terminal failure can carry partial effects. Cleanup status is not a rollback claim.

`close` names exactly one execution, control or workspace. It returns stopping/quiescent status with cleanup errors; the native stop admission fence is independent of any MCP task-cancel acknowledgement. A retry of close is idempotent cleanup, not renewed authority.

## Recommended validation commands

From the repository root after the documentation tooling is present:

```sh
python3 docs/aid-system/contracts/prepare.py
python3 docs/aid-system/contracts/validate.py --report-dir build/aid-design-validation
bunx --package typescript@5.9.3 tsc -p docs/aid-system/contracts/tsconfig.json
```

TypeScript is a design-validation toolchain pin, not a production dependency upgrade. The validator checks JSON Schema using the pinned validation environment when available and must fail a required schema/type check rather than silently mark it skipped as passed. It validates relative links, numbered references, package DAG, requirement coverage, preserved-document identity, positive/negative wire examples and executable state-model counterexamples.

A final manifest records every exported file's bytes and digest. The export must contain the actual nonempty corpus and be re-opened after creation. A source-availability check or a keyword count is not a semantic review or a signed native qualification. G01–G12 remain `not-run` until implementation executes them.

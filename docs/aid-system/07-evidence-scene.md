# D07 — Queryable evidence service and scene representation

**Purpose:** expose the evidence needed for intelligent control without flooding model context or pretending the runtime knows more than it observed. **Depends on:** D02, D05, [D08](08-accessibility.md), [D09](09-capture-artifacts.md), [D11](11-spatial-validity.md).

## 1. Baseline and research

V2 combines a formatted AX tree and optional PNG in a snapshot lease. That is useful but makes the text/image payload the main unit of perception. The target separates sensor acquisition, structured records, local querying, artifact encoding and provider emission. ScreenCaptureKit frame callbacks and AX bulk/paged reads provide substrate, not an atomic omniscient scene graph. See [S11–S15](29-research-register.md#s11). Model labels and visual tracker outputs must retain different provenance from AX-reported roles.

## 2. Data model

The scene is a versioned graph of `Seat`, `Display`, `Application`, `Window`, `Element`, `Surface`, `Overlay`, `Frame`, and `Observation` records. Relations include contains, focused-in, modal-for, occludes, anchored-to, and derived-from. An observation is an immutable selection of records/evidence at stated times; the live graph is mutable and is never returned as though it were immutable history.

Every fact carries `sourceKind` (`ax`, `window-server`, `capture`, `pixel-analysis`, `model-annotation`, `fixture`), source object/generation, sample interval, quality/coverage and any derivation reference. Keep platform-reported enabled state separate from a model hypothesis that an icon is clickable. Do not turn a pixel rectangle into an AX handle or silently overwrite a platform title with an inferred label.

Window and element IDs are owner/runtime-generation scoped. Evidence content may be shared internally only when permissions, seat and capture identity match. A record's existence in a cache does not grant access to another assistant or project.

## 3. Observation contract

`Observation` includes immutable ID, seat/runtime/control generation, target identities, capture frame ID/time, AX read start/end, coordinate frames, input barrier, coverage/truncation, selected structured nodes, delta base if applicable, image artifact references and uncertainty statements. `observation_consistent` is retained only as optional evidence metadata, not a global input permit.

Provide `observe.window`, `observe.region`, `observe.focus`, `observe.desktop` and `observe.changes`. Desktop capture requires broader scope than one application. First-use default is an overview plus a bounded relevant AX scope. Scripts can explicitly request no images, selected crops, raw children, and larger budgets. Neither an omitted control nor a truncated subtree means the control does not exist.

`Observation.query` searches the immutable material already captured. `Window.query` may query/reconcile current evidence within its explicit scope. These methods must not share the same name with different invisible freshness semantics. Query results include match count/coverage, not merely the first match. `.one()` throws on zero or multiple matches, even if results were sorted by confidence.

## 4. Query engine

Use a declarative selector AST: scope handle, roles, exact/normalized/regex name predicate, enabled/selected/focused predicates, relation constraints, geometric intersection and result budget. Evaluation is local over indexed facts, with a native scoped-refresh request if the required freshness is not met. Unknown fields are validation errors. Regular expressions run in a bounded guest/native-safe evaluator with a timeout; they must not block the input driver.

Index stable fields (role, normalized name, window ID, parent ID), geometry in per-window spatial indexes, and revision lists per change dimension. Avoid a single global tree revision. Return a `QueryReceipt` describing cached versus freshly queried fields, unsupported predicates and incomplete coverage. Sorting by geometric/semantic score can help exploration but never converts ambiguity into permission to click.

Raw access uses pagination with opaque cursor + scope generation. If the scope changes, return `DELTA_BASE_LOST`/restart information rather than concatenating two different trees into a false complete result. Paginated AX children may change during traversal; report the interval and generation evidence.

## 5. Attention-directed output

An image request declares target region, overview size, detail regions, format/quality policy, redaction and maximum pixels. The evidence service chooses existing frame data where valid, derives exact crop transforms, and encodes only requested outputs. A model can request a small overview and lossless text/control detail instead of repeatedly increasing one full-window PNG.

A structured text projection is for readability, not the canonical store. Each element carries a stable ID with role/name/actions/bounds where permitted. Include expandable placeholders for unexpanded subtrees and clear truncation causes: node, character, time, permission, unsupported source or stale scope. Do not append a megabyte of raw JSON after claiming the context was pruned.

The SDK can perform local transforms and emit a concise result. Tool output suppression is not evidence deletion: the execution journal records which artifacts were produced and which were exported, without persisting their sensitive contents by default.

## 6. Deltas and consistency

A delta names exact base observation, target/runtime generation, additions/removals/field changes and coverage boundaries. The client must acknowledge possession of the base or request a full projection. Never compute a global diff between unrelated windows or call a missing subtree “removed” when it was simply outside the next query budget.

Pixels and AX have different clocks and collection intervals. A frame may precede a label update, or vice versa. Return both times and input relationships. A relevant mismatched label/geometry causes target revalidation, not repeated attempts to freeze the entire application. A background progress counter can change without invalidating a stable button, while a label changing from Save to Send changes semantic meaning.

## 7. Caching and resource policy

Default live structured-evidence budget is 32 MiB per control, 128 MiB process-wide, with bounded node counts per application and LRU eviction of unpinned records. These are initial profile values, not performance results. Observations referenced by active checkpoints remain pinned within their declared budget; insufficient capacity returns a clear admission error rather than silently degrading evidence.

Image/frame memory is accounted separately by D09. Expiring a JavaScript reference cannot delete an image already exported to the provider. Retaining a JavaScript variable does not indefinitely pin sensitive pixels. Expired artifacts return `RESOURCE_EXPIRED`; pure metadata may remain for debugging if policy allows.

## 8. Failure and uncertainty

Unsupported AX: return image evidence plus the explicit missing semantic coverage. Missing screen permission: return available AX without inventing an image. Changed window: invalidate matching current scope, retain prior observation as historical evidence only. Lost delta base: full re-observe, not patch guessing. Empty query from incomplete data: `matches=[]` plus incomplete status; no claim of absence.

Pixel analysis may return several candidates and measurable uncertainty. The model can annotate a candidate for future tracking, but the runtime validates its spatial contract and cannot guarantee semantic identity through arbitrary visual similarity. No hidden OCR/vision model is assumed; providers are explicit and independently qualified.

## 9. Cozea implementation and tests

Implement host-side `EvidenceStore`, `ObservationAssembler`, `ProjectionEncoder`, `ArtifactAccessPolicy` and native `SceneRegistry`/scoped sensor providers. Evolve v2 `ObservationStore`, `AccessibilityTree` and `ScreenshotGeometry` rather than maintaining a second invisible snapshot authority. Provider adapters receive typed evidence packets and actual image blocks, not an artifact ID the model cannot dereference.

**EV-01:** scoped observation can be expanded to raw data with stable provenance. **EV-02:** `.one()` rejects ambiguous matches. **EV-03:** crop-to-input roundtrip is exact within declared tolerance. **EV-04:** lost delta base triggers a full request. **EV-05:** truncation is not interpreted as deletion. **EV-06:** AX/pixel mismatch is represented, not hidden. **EV-07:** one principal cannot query another's observation IDs. **EV-08:** no extra image encoding occurs after ordinary input. **EV-09:** checkpoint pins respect budgets and expire honestly. **EV-10:** selector evaluation cannot hang the driver. The same tests run with deliberately weak AX fixtures and dynamic labels.

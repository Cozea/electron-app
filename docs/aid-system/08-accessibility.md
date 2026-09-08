# D08 — Accessibility acquisition, identity and incremental reconciliation

**Purpose:** make macOS Accessibility a reliable, bounded semantic sensor/action provider without requiring a complete tree for every effect. **Baseline:** `AccessibilityRuntime`, `AXAccess`, `AXReadBudget`, `AccessibilityObserver`, `AccessibilityTree` and retained observation elements. **Primary sources:** [S11–S12](29-research-register.md#s11), [S48](29-research-register.md#s48).

## 1. Selected architecture

Use one dedicated serial AX worker lane per actively observed process, with a process-wide concurrency budget of four read lanes initially. Mutable native AX references stay on their owning lane or in explicitly immutable retained wrappers. A hung app must not stall observations of unrelated apps. AppKit presentation and input scheduling never execute AX traversal synchronously.

A lane owns its application object, observer subscriptions, retained element registry, read budgets and dirty-scope queue. It is not a foreground-input owner; semantic mutations still require the global seat permit and native authorization. Swift actor isolation alone does not serialize an entire multi-await operation.

## 2. Exact read semantics

All attribute reads, action-name queries and settable queries pass through one deadline-aware adapter. Configure `AXUIElementSetMessagingTimeout` on the exact AX object being queried, using the smaller of the per-message cap and remaining read budget. A timeout on a parent does not make arbitrary descendant calls bounded. Retain the v2 review fix and extend tests to every entry point.

Use `AXUIElementCopyMultipleAttributeValues` for a coherent group of fields on one node when supported. Preserve positional errors/CFNull; do not collapse an error into an empty string. This reduces calls but does not make a multi-node snapshot atomic. Use `AXUIElementCopyAttributeValues` for bounded child pages rather than copying arbitrarily huge arrays. Source support is S11/S12; compile and fixture-check exact Swift bridging and ownership.

Default exploration budget remains 1,200 nodes/depth64 as a maximum, with a 200-ms soft traversal budget and 500-ms hard request budget as proposed performance profiles. A target-specific validation should normally need a handful of fields, not a full tree. Large explicit expansion is paginated/extendable, not silently truncated. Deadline exhaustion returns a partial observation with a cause, not a successful complete tree.

## 3. Traversal algorithm

Start from a verified window or app-menu scope. Maintain a visited identity set to avoid malformed cycles, a breadth-prioritized queue for visible/actionable/focused regions, and explicit child-page cursors. Query required identity/role/name/value/frame/enabled/action fields in bounded groups; defer expensive optional attributes until requested. Render structure after acquisition, never inside observer callbacks.

Preserve unknown roles and actions in raw records. A simplified presentation may map familiar roles but cannot delete anonymous actionable web controls. Do not infer enabled state from presence of an action name alone. Accessible text may be sensitive; secure text values are never emitted, and uncertain secure fields require policy-aware handling.

Where runtime accessibility enabling is needed for Electron-like applications, scope the existing best-effort `AXManualAccessibility`/`AXEnhancedUserInterface` behavior to the target launch identity and record failures. These are compatibility behaviors in current code, not guarantees that all apps expose a complete tree.

## 4. Identity and target validation

An `ElementRecord` retains native element identity, process launch identity, window generation, observation lineage, role, semantic label/action signature and frame. Equality through a retained AX object is useful but not a promise of identity across virtualized list reuse. Validate the fields relevant to intent before semantic dispatch or pointer placement.

A selector may reacquire a target only under an explicitly named scope and unique semantic match. If the old element disappears and a similar element appears, report replacement and require the caller's allowed reacquisition policy. Never silently preserve the old ID while replacing its native object. Recycled window/PID IDs are rejected by launch/generation checks.

For a click: re-read role/action availability, enabled state, semantic name when meaningful, and frame. After cursor travel, repeat the critical checks. A checkbox may legitimately change value after our click; that is result evidence, not proof a second click is safe. For `setValue`, validate the exact settable attribute and explicit mode; do not append stale text or fall back to clipboard.

## 5. Observer design

Use one `AXObserver` per active process with a dedicated CFRunLoop. Callback does minimal retention and event enqueue; it must not query AX, render text or access AppKit synchronously. Assign a monotonically increasing receive sequence so delayed tasks cannot reorder events invisibly. Observation timestamps describe receipt, not the instant the application internally changed.

Subscribe best-effort to application focus/window creation, relevant window move/resize/destroy/title, focused control changes, and explicitly watched element changes. Unsupported notification registration is recorded as a coverage gap, not fatal to all observation. Destruction or process termination invalidates native references immediately; semantic/layout/value signals mark the appropriate scope dirty.

The existing observer associates some otherwise-unmatched callbacks with all tracked windows in a process. Replace that with explicit source lineage where available and an `unknown-scope` dirty signal where it is not. An unknown signal schedules bounded relevant validation; it is not a universal permanent action veto.

## 6. Reconciliation policy

Events are hints, not complete truth. Dirty scope reconciliation runs on demand before a dependent action/query, on relevant observer events, and at a low-rate fallback for active watches. Initial fallback interval is 250 ms for an active semantic watch and 1 second for idle metadata, bounded by grant/budget. No unconditional repeated 1,200-node traversal at those rates.

Coalesce repeated value notifications for the same node, retaining the newest sequence and change count. Never coalesce away destruction, foreground loss or a modal transition that must stop input. If queue capacity is exceeded, mark coverage degraded and force targeted validation; do not silently drop safety-critical events and claim freshness.

Content changes inside a stable canvas may lack AX representation. That is normal. The surface contract combines available AX geometry with pixel/foreground evidence rather than interpreting “no AX change” as “nothing drawn.”

## 7. Timeouts, hangs and cancellation

AX messages can block until their configured timeout. Cancellation prevents further reads/effects immediately but may not interrupt an already blocking OS call. Do not promise hard real-time cancellation of synchronous AX IPC. Keep the urgent stop and pointer cleanup outside the AX lane, and record actual OS delay separately.

`cannotComplete` is not identical to destroyed identity. Return the raw error and phase. Limited read retries may be attempted within the deadline. A semantic action returning an uncertain error after dispatch must not fall through to a physical click automatically. Result semantics are D16.

## 8. Tests and implementation

Add adapter injection points so unit tests count every AX entry, exact timeout assignment and cancellation gate. Do not replace actual OS input with fixture-private actions in live qualification.

**AX-01:** every node read/action query/settable check obeys remaining budget. **AX-02:** app A hang does not block app B or native stop. **AX-03:** dynamic progress text does not prevent stable button validation. **AX-04:** same-position label/action replacement invalidates semantics. **AX-05:** huge/virtualized/cyclic trees return bounded partial results. **AX-06:** destroyed refs and PID reuse are rejected. **AX-07:** incomplete notification support is disclosed and reconciled. **AX-08:** raw anonymous actions survive formatting. **AX-09:** modifier/clipboard fallback never occurs after uncertain AX action. **AX-10:** callbacks retain safe lifetimes through observer teardown and do not leak process records. Keep baseline tests and add permissioned AppKit, WKWebView and Electron fixtures.

# DevApp Worker Protocol

The DevApp worker protocol is the capability-gated wire contract between an authored worker and
Cozea's main-process host. Its version is independent from `manifestVersion`: the manifest version
governs how `cozea-devapp.json` is read, while the worker protocol governs port bootstrap, request,
response, event, method, parameter, result, and authorization semantics.

## Current contract

- Current version: `1`
- Supported host range: `1` through `1`
- Manifest field: `worker.protocolVersion`
- Compatibility alias: a version omitted by a pre-Phase-6 manifest means version `1` only
- Negotiation: exact-match selection; Cozea never silently downgrades a package

The parser normalizes the compatibility alias into an explicit version before any worker starts.
New schemas, scaffolds, examples, and `@cozea/devapp-api` clients must always write the field.

At process creation, main transfers the worker port with this bootstrap envelope:

```json
{
  "kind": "cozea-devapp-port",
  "protocolVersion": 1,
  "supportedProtocolVersions": { "min": 1, "max": 1 }
}
```

Every request, response, and event carries the selected `protocolVersion`. For compatibility with
the Phase-5 development workers, an omitted message version is accepted as version 1 only. An
explicit mismatch is malformed input and is dropped before authorization or method dispatch. Host
responses always include the explicit selected version.

## Compatibility policy

Protocol versions are monotonic positive integers. A released version is immutable. Introduce a
new version when a worker may depend on any of the following changing:

- a method is added, removed, or renamed;
- request parameters or response results change shape or meaning;
- event topics or payloads change;
- authorization requirements or capability-to-method mappings change;
- error behavior changes in a way worker code can branch on.

Documentation, diagnostics, and implementation fixes that preserve observable behavior do not
require a bump.

The host may support multiple exact versions during a migration window. Each version keeps its own
parser and method table; a newer parser must not reinterpret an older envelope. Removing a version
requires a documented product migration and leaves packages targeting it stopped with an
actionable unsupported-version diagnostic. The host never selects a lower version than the one the
package declared.

`manifestVersion` is bumped separately only when an older Cozea cannot safely understand the
manifest structure. Adding `worker.protocolVersion` does not bump it because existing version-1
manifests already existed and are unambiguously normalized to worker protocol 1.

## Trust and security

The version is not authority. Capabilities still come only from the user-approved `DevAppGrant`,
and every request still passes the host capability table. Unsupported package versions are blocked
before code is spawned; mismatched message envelopes are rejected before the gate; workers cannot
negotiate themselves into a broader method set.

Published approvals already bind to immutable artifact content, so changing the declared protocol
changes the artifact hash. Development approval remains source- and capability-scoped for the
current session: changing protocol alone restarts the worker but does not imply new capability.

The future view-to-worker client must reuse this selected version and bootstrap metadata. It must
not create another independently versioned bridge.

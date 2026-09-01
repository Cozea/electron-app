# DevApp Worker Security Review

Status: completed 2026-09-01 for the development-worker host and protocol-v1 boundary.

This review treats authored worker code, worker messages, manifests, paths, and renderer IPC as
hostile. It covers the local development preview path that exists today. Published worker
execution does not exist and must remain disconnected until the Phase 8 container/VM runtime is
available.

## Security decision

Electron `utilityProcess` is a separate Node process, not a security sandbox. Electron 40's
bundled Node permission model can restrict direct filesystem, child-process, worker-thread,
native-addon, inspector, and WASI access, but it does not restrict network access and Node does
not describe the permission model as a complete security boundary. Cozea therefore uses those
flags only as defense in depth.

The resulting product rules are:

- every development package that declares a worker requires an explicit, expiring session
  approval, even when it declares zero host capabilities;
- the approval UI states that worker code can reach the network and is not OS-sandboxed;
- the worker receives only package/data filesystem allowances and a minimal environment;
- every host request still passes protocol parsing, the exact v1 method table, capability
  authorization, binding enforcement, parameter validation, and symlink-aware host services;
- no published release can start this worker host; external worker authoring remains blocked on
  the container runtime.

Primary platform references: [Electron utility processes](https://www.electronjs.org/docs/latest/api/utility-process),
[Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model), and
[Node permission model](https://nodejs.org/api/permissions.html).

## Development power is intentional

A development DevApp is trusted project code, not a consumer installation. Its worker may reach
the network directly, read its package, persist app-owned data, and use every host operation its
approved capability grant and protocol version expose. Approval is source-and-grant scoped for the
session, so ordinary edits do not trigger a new prompt unless the requested authority widens.

The current protocol-v1 list below is an implementation boundary, not a product decision that
development apps should remain weak. Declared `git.*`, machine-wide `fs.*`, `terminal.spawn`, and
`process.spawn` capabilities do not yet have view-callable v1 methods. Completing those APIs must
use a new explicit protocol version and honest full-machine approval copy; it should not be
reframed as a reason to deny powerful local development workflows. Consumer/published execution
remains a separate trust tier.

## Findings closed

| Finding                                                                                                   | Resolution                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A zero-capability worker could start without a prompt despite unavoidable Node/network reach              | Every worker now requires explicit development approval; view-only packages remain prompt-free.                                                                                                                                                       |
| A grant could expire while an idle worker kept running                                                    | The host schedules expiry teardown and also checks expiry before every request.                                                                                                                                                                       |
| The manifest could change between the rendered prompt and approval                                        | Approval re-reads the manifest from disk and compares the exact displayed grant fingerprint before recording trust.                                                                                                                                   |
| Narrowing a manifest grant could leave the old broader worker alive                                       | Entrypoint, package root, grant, protocol, binding, and expiry are immutable execution identity; a change replaces the process while preserving valid leases.                                                                                         |
| Lexically confined source/project paths could escape through symlinks                                     | Preview sources, worker/view entries, read/write/list/reveal handlers, package roots, entrypoints, and data roots resolve and re-check real paths.                                                                                                    |
| Handler exceptions returned host paths to worker code                                                     | Worker responses are generic; detailed diagnostics stay in the user-visible host log ring.                                                                                                                                                            |
| Protocol v1 advertised methods that had no handler                                                        | The v1 table now contains exactly the six implemented methods, and a test requires the table and handler keys to match. Other vocabulary entries remain unavailable until a future explicit protocol version implements them.                         |
| Messages, logs, requests, workers, leases, previews, manifests, and file operations had incomplete bounds | The host now caps each class, including a 12 MiB structured-message graph, 16 in-flight requests, 200 log lines, 16 workers, 64 leases, 64 preview sessions, 1 MiB manifests, 5 MiB text files, and 10,000 directory entries.                         |
| Reopening one source could overwrite another surface's lease; an unmounted pending open could leak        | Preview ownership is multi-lease, close is lease-specific, watchers survive until the last lease, and late open results release themselves. Each renderer open attempt owns a unique lease so React Strict Mode cleanup cannot release its successor. |
| Worker data paths and environment inherited unnecessary machine details                                   | Data directories use hashed worker identities and the child receives only `NODE_ENV` and its own data-directory variable.                                                                                                                             |
| The DevApp view could not reach its own worker without adding another authority path                      | A DevApp-only preload receives a main-issued port through a bounded, version-checked broker. The view gets no Electron IPC or host method; privileged worker requests stay on the original capability-gated port.                                     |
| A boolean could claim an agent surface without defining anything callable                                | Worker manifests now require bounded concrete tool declarations. Authenticated sessions expose them through the read-only `devapp_tool_catalog`; invocation remains explicitly unavailable until Phase 8.                                             |

## Verification evidence

Automated verification passes all three TypeScript projects, lint, 212 test files / 1,613 tests,
the Electron IPC and renderer-bridge audits, production build, the pinned T3 runtime check, and
`git diff --check`.

The 2026-09-01 live Electron smoke used the visible development-preview approval flow against a
real view-plus-worker package. Approval dismissed, the confined `cozea-devapp://` view rendered,
and Electron started the worker utility process with the 512 MiB heap ceiling plus the exact
package-read, data-read, and data-write permission flags. The smoke also found and closed a React
Strict Mode lease race and made approval failures visible instead of silently swallowing them.
The same package then sent a protocol-v1 request from its living guest to its approved utility
worker and rendered the worker response. The acceptance pass also requires every sandboxed picker
or PiP preload to be emitted as a self-contained single-entry artifact; a relative Rollup chunk
was rejected by Electron's sandbox before this build invariant was added.

## Protocol-v1 callable surface

- `project.metadata`
- `project.readFile`
- `project.listDirectory`
- `project.writeFile`
- `shell.open`
- `shell.reveal`

Methods absent from this list fail closed as `unknown-method`, regardless of what a manifest
declares. Adding callable methods changes the worker protocol and requires the versioning process
in [DevApp Worker Protocol](./devapp-worker-protocol.md).

## Residual risks and required ordering

- Node permissions cannot provide network isolation or an OS-enforced filesystem boundary.
  Symlink-aware checks substantially narrow host-mediated operations, but do not replace
  directory-handle confinement against a malicious concurrent local process.
- Development approval is intentionally source-and-capability scoped rather than content-hash
  scoped, so ordinary authoring edits do not prompt continuously. This is suitable only for a
  user-authorized local project, not an installed third-party artifact.
- The Phase 4 view bridge remains deliberately low-level beneath the Phase 6 public typed client.
  Package-private methods share protocol v1 envelopes; host authority remains exclusively behind
  the original capability-gated worker port.
- Published worker execution, external worker packages, and autonomous worker tools must not ship
  before the container/VM adapter. Phase 6 may deliver schema, typings, view-only scaffolding, and
  documentation first, but must mark worker execution as unavailable until Phase 8.

These are architectural constraints, not deferred bugs to hide behind a feature flag.

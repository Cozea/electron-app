# DevApp runtime contract

DevApp manifest version 2 separates three questions that older release metadata mixed together:

1. What does the package contain (`view`, `worker`, and `service`)?
2. Where does executable package code run (`device` or `hosted`)?
3. Who owns state created by that runtime (`none`, `device`, or `organization`)?

This contract is exact and fail-closed. Cozea does not infer placement, state ownership, or an
execution boundary for a worker or Node service.

## Development and published execution

Local development packages always run on the developer's device as trusted development code. A
worker still requires an explicit, expiring capability approval, but the development host is not
presented as an OS sandbox. This is intentional: a DevApp developer must be able to build, inspect,
and integration-test powerful tooling against local projects.

Published workers and Node services are different. Their immutable release parts must declare the
`container` boundary. On a device, each release runs in an app-owned lightweight Linux VM through
Apple Containerization. Hosted releases run through the hosted container adapter. If the selected
adapter, exact signed image, or required runtime resources are unavailable, execution fails closed;
Cozea never falls back to `utilityProcess`, an ordinary child process, or a shell command.

Static views contain no executable package part and therefore declare no runtime.

## Placement and state

| Placement | Allowed state  | Meaning                                                                                         |
| --------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `device`  | `none`         | Writable runtime data is ephemeral and removed with the instance.                               |
| `device`  | `device`       | Cozea owns a publication-scoped device volume. It survives release replacement until uninstall. |
| `hosted`  | `none`         | Runtime disk is ephemeral. Durable data must be external.                                       |
| `hosted`  | `organization` | State is organization-scoped and persists through the hosted state adapter.                     |

`device` + `organization` and `hosted` + `device` are invalid. A package cannot claim a state scope
that its selected runtime cannot authoritatively own.

Container root filesystems are immutable release images. A bounded writable layer holds ephemeral
runtime changes. Device state is a separate app-owned volume, not a writable copy of the release.
Hosted instance disks are disposable; organization state belongs in the durable hosted state
service and object storage.

The shipping adapters, resource ceilings, lease model, signed-image chain, and deployment
requirements are specified in [Published DevApp Contained Runtime](./devapp-contained-runtime.md).

## Local filesystem access

Containers do not receive the user's home directory, project root, or arbitrary host paths by
default. The preferred path is the existing Cozea capability broker (`project.read`,
`project.write`, `fs.read`, and `fs.write`), which applies workspace confinement and audit rules to
each operation.

When an app genuinely needs native filesystem semantics—file watching, a toolchain walking a tree,
or memory-mapped files—the user may create an explicit folder grant. A grant records:

- the exact canonical host folder;
- read-only or read-write access;
- the fixed guest mount point;
- the publication and release allowed to use it;
- expiry and revocation metadata.

The device adapter presents only those paths through a VirtioFS share. Symlinks are resolved before
approval, mounts cannot target `/`, `/proc`, `/sys`, `/dev`, or another reserved guest path, and a
worker or agent cannot create, widen, renew, or silently reuse a grant. Hosted runtimes cannot mount
local files; explicit uploads or a device-side broker are required.

## Agent invocation

Tool declarations are catalog metadata, not authority. An agent invocation requires all of the
following at call time:

- an authenticated Cozea assistant session;
- an installed exact release whose worker declares the tool;
- a running contained instance for that release;
- an unexpired capability grant with `agentInvocable: true`;
- input that validates against the declared bounded schema;
- the same placement, origin, filesystem, and network rules as a user-triggered call.

Agents cannot approve capabilities, trust a release, grant a folder, change placement, or widen
state scope. Direct user revocation interrupts outstanding work and prevents new calls.

## Image identity and supply chain

Executable releases name an OCI image by manifest-list digest and include per-platform image
digests. Cozea accepts only supported Linux platforms, a successful reproducible-build attestation,
and a signature from the configured Cozea runtime signing key. Runtime IDs, image paths, mount
paths, and credentials are runtime-owned and are never persisted in tile or workbench layout data.

The central builder receives immutable source/artifact input, builds both supported platforms in a
network-controlled environment, emits deterministic OCI metadata, scans the result, signs the
manifest digest, and publishes it before Convex can activate the release. The desktop verifies the
same release identity again before starting a device container. Cloudflare independently repeats
that verification before starting a hosted container.

A published Node service records an explicit network contract because Cozea must reach its private
HTTP listener. Worker-only runtimes receive outbound networking only through `net.outbound`.
Hosted egress begins deny-by-default; device networking is enabled only for those two cases.

## Failure rules

- No exact image: do not start.
- Invalid signature or attestation: do not install or start.
- Missing device helper, kernel, or init filesystem: report runtime unavailable; do not fall back.
- Hosted runtime requested while offline: report hosted unavailable; do not run it on the device.
- State or folder grant does not match the immutable release: do not attach it.
- Container exits or the helper disconnects: revoke its live tool endpoint and leases before retry.
- Hosted client disappears: let its renewable lease expire; do not let another client stop a
  still-leased organization runtime.

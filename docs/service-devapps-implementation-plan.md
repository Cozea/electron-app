# Service DevApps Implementation Plan

## Status

Implemented for the private macOS Apple-silicon beta on 2026-08-29. The shipped slice includes the
unchanged static lane, automatic Next.js standalone and Nuxt server adapters, an explicit portable
Node output adapter, strict manifests, separate limits, verified cache preparation, publication-
scoped runtime leases, authenticated HTTP/WebSocket gatewaying, encrypted local environment
configuration, release-bound trust approval, logs, Stop, Restart, and exact-origin navigation.

SvelteKit and Remix/React Router are accepted through the explicit adapter when their build is
self-contained. Automatic dependency tracing for those frameworks remains deferred rather than
blindly packaging a source `node_modules`. OS-enforced filesystem and outbound-network isolation
remains the documented post-beta container/VM milestone; the UI therefore calls these releases
trusted organization code.

## Goal

An organization member can publish and another organization member can open a full-stack DevApp
without receiving the source project, cloning a repository, installing dependencies, or running a
mutable development command.

The first complete vertical slice is a macOS Apple-silicon Next.js standalone application with
SSR and API routes. Static DevApps must continue to publish and open exactly as they do now.

## Product model

Every organization DevApp release has one of two immutable runtime kinds:

- `static`: the current HTML/CSS/JavaScript artifact served from the per-release
  `cozea-devapp://` origin.
- `service`: a built server payload started locally by Cozea and exposed only through a
  release-scoped loopback gateway origin.

The local project DevApp and Dev Server flows remain development tools. They are not publication
formats and must not be used to launch an organization release on a consumer device.

A service release runs separately on each Mac. Its writable files and local database are therefore
device-local. Applications that need shared data must use an external HTTPS service. Cozea-hosted
shared backends are a future third runtime kind, not part of this plan.

## Non-goals

- Shipping the source repository or its `.env` files.
- Running `dev`, `start`, package installation, or arbitrary shell commands on consumer devices.
- Automatically deploying an application server to the public internet.
- Claiming that a normal macOS child process is a strong arbitrary-code sandbox.
- Supporting Intel macOS, Windows, Linux, Docker, native mobile servers, or arbitrary language
  runtimes in the first vertical slice.
- Making local SQLite or filesystem state shared between organization devices.

## Trust boundary

Service DevApps execute code. Until Cozea has a hardened container or VM boundary, service releases
are explicitly **trusted organization code**:

- only organization administrators or project managers may publish them;
- the first launch shows the publisher device, release version, runtime, and requested permissions;
- an approval is bound to the release content hash and permission-set hash;
- changed permissions require approval again;
- Cozea does not pass project paths or workspace handles to the process, although the OS does not
  enforce that boundary in the trusted-code phase;
- Cozea marks the artifact directory read-only and gives the process one publication-scoped writable
  data directory, but presents this as a convention and defense in depth rather than a sandbox;
- the service binds to loopback only and receives a minimal, allowlisted environment;
- secrets are injected into the service process and never exposed to the renderer or artifact files;
- Stop, logs, health, crash state, and resource use are visible to the user.

The Store and launch confirmation must use that wording. Until a container or VM boundary exists,
permission declarations are reviewable trust disclosures. They are not claims that Cozea can prevent
the service from reading files available to the current macOS user, opening outbound connections, or
spawning descendants. The service feature remains beta-gated to trusted organizations on that basis.

## Release manifest

Add a versioned `cozea-devapp.json` at the artifact root. The manifest is covered by the existing
ZIP content hash.

```json
{
  "schemaVersion": 1,
  "kind": "service",
  "platform": "darwin",
  "arch": "arm64",
  "framework": "nextjs",
  "runtime": {
    "kind": "node",
    "entrypoint": "server/server.js",
    "args": []
  },
  "server": {
    "hostEnv": "HOSTNAME",
    "portEnv": "PORT",
    "healthPath": "/",
    "startupTimeoutMs": 30000
  },
  "environment": [
    {
      "name": "EXAMPLE_API_KEY",
      "required": true,
      "secret": true,
      "description": "API credential used by the server"
    }
  ],
  "permissions": {
    "network": true,
    "persistentData": true
  }
}
```

Validation rules:

- reject unknown schema versions, runtime kinds, permission keys, absolute paths, traversal,
  control characters, shell metacharacter semantics, and oversized strings/arrays;
- entrypoint and arguments are data passed directly to a process API, never joined into a shell;
- `healthPath` is an origin-relative HTTP path;
- environment names are unique and match a strict identifier grammar;
- reserved environment names such as `PATH`, `HOME`, loader injection variables, Electron flags,
  and Cozea-internal variables cannot be declared;
- service artifacts declare an exact platform and architecture;
- static releases retain the current `entryPath` contract and need no generated manifest during the
  compatibility period.

Put the shared parser and validator in `shared/serviceDevAppManifest.ts`. Renderer, main process,
and tests must consume the same validated shape.

## Artifact layout and adapters

Build into a new staging directory rather than ZIPing a framework directory in place:

```text
cozea-devapp.json
server/
public/
metadata/
```

The staging walker retains the current path, entry-count, compression-ratio, symlink, CRC, and hash
checks. Service releases receive separate, deliberately chosen compressed and expanded limits. Do
not silently raise the static limits.

Framework adapters implement a common interface:

```ts
interface ServiceDevAppAdapter {
  id: string
  detect(projectRoot: string): Promise<AdapterMatch | null>
  build(context: BuildContext): Promise<ServiceArtifactDescriptor>
  validate(stagingRoot: string, manifest: ServiceDevAppManifest): Promise<void>
}
```

Implementation order:

1. Next.js standalone output.
2. Nuxt server output.
3. SvelteKit adapter-node output.
4. Remix/React Router production Node output.
5. Explicit generic manifest for an already self-contained Node server bundle.

An adapter must prove that its entrypoint and required static assets exist. If the framework is
recognized but not configured for a portable server build, publishing stops with exact remediation
instead of falling back to a raw project command or packaging `node_modules` blindly.

Native executable files and native Node addons are rejected in the first slice. This keeps the
runtime portable across supported Apple-silicon Macs and avoids silently executing unclassified
payloads.

## Publisher flow

Extend the current publisher as follows:

1. Inspect the project before reserving an upload.
2. If a static `index.html` output is available, default to `static`.
3. If a supported server adapter matches, present `Static` or `Service` only when both are valid;
   otherwise select the one valid kind and explain it.
4. Show runtime, platform, environment requirements, permissions, and expected artifact size.
5. Run the production build using an executable plus argument array. Remove `shell: true` from the
   organization build path.
6. Stage and validate the release payload.
7. ZIP, hash, upload, verify, and activate through the existing reservation flow.
8. Persist no secrets, absolute paths, source directories, or build commands in Convex.

Cancellation must terminate the entire build process group and abandon the upload reservation, as
the static publisher does today.

For a self-contained server output not covered by an automatic adapter, publishers opt in through
`package.json`:

```json
{
  "cozeaDevApp": {
    "service": {
      "outputDir": "service-output",
      "entrypoint": "server.js",
      "healthPath": "/"
    },
    "environment": [
      {
        "name": "DATABASE_URL",
        "required": true,
        "secret": true,
        "description": "Production database connection"
      }
    ],
    "permissions": {
      "network": true,
      "persistentData": true
    }
  }
}
```

`outputDir` and `entrypoint` are artifact-relative paths. Optional `args`, `hostEnv`, `portEnv`,
`startupTimeoutMs`, and `healthPath` use the same manifest validator. The output must already contain
every JavaScript dependency; consumers never run an install command.

## Convex model and authorization

Extend `devAppReleases` with validated release metadata:

- `runtimeKind: "static" | "service"`;
- `manifestVersion` for service releases;
- `platform` and `arch` for service releases;
- `permissionSetHash`;
- optional bounded presentation metadata such as declared environment names, excluding values.

Continue storing the artifact blob, content hash, framework, and active immutable release pointer.
Existing rows without `runtimeKind` are interpreted as `static` until test data is reset.

`publish` must validate that the registered upload, declared runtime kind, manifest metadata, source
project, organization, and authenticated publisher all agree. Consumer queries return only the
bounded launch metadata and a short-lived authorized download URL.

Add a per-device approval record keyed by `(device identity, publication, content hash,
permissionSetHash)`. Revoking organization membership must immediately prevent new download URLs
and launches. A running service is stopped on the next authorization refresh or app wake.

Environment values do not belong in Convex in this phase.

## Local artifact preparation

Refactor `OrgDevAppArtifactService` into shared cache mechanics plus two preparers:

- `StaticOrgDevAppArtifactService` preserves current custom-protocol behavior.
- `ServiceOrgDevAppArtifactService` downloads, verifies, unpacks, validates the manifest, and leases
  an immutable release directory to the runtime supervisor.

Cache keys remain the content hash. Active runtime leases prevent eviction. Use separate static and
service quotas so a large service release cannot evict every static app. Pruning must be age-, size-,
and count-bounded, skip active leases, and remove incomplete staging directories after crashes.

The final directory is not modified after its ready marker is written. Writable data lives under a
separate path keyed by publication ID so it survives a release update without contaminating the
artifact hash.

## Runtime supervisor

Add an Electron-main `OrgDevAppRuntimeService`. It owns all service processes and is the only layer
allowed to start or stop them.

Runtime identity is `(publicationId, releaseId)`. Multiple tiles for the same release share one
process through leases rather than starting duplicates.

State machine:

```text
idle -> downloading -> needs_configuration -> starting -> ready
                                              |           |
                                              v           v
                                            failed <--- crashed
ready -> stopping -> idle
```

Required behavior:

- allocate a port through `DevServerPortBroker` in a distinct `org-devapp-service` namespace;
- start the packaged entrypoint with a direct process invocation and a sanitized environment;
- force host to `127.0.0.1` and the allocated port;
- use an application-owned runtime rather than whichever `node`, `bun`, or package manager appears
  first in the user's shell;
- capture bounded stdout/stderr into a ring buffer and expose structured status over IPC;
- poll the declared health endpoint with an upper-bounded timeout;
- coalesce simultaneous starts;
- detect process exit and surface the last bounded log lines;
- stop gracefully, verify termination, then force-kill the exact process group if needed;
- stop all service processes during logout, access revocation, app quit, and explicit cache/data
  deletion;
- do not inherit project paths, Git credentials, provider tokens, or the parent process environment.

Ship one known Node runtime with Cozea for the first adapters. Do not install a runtime or production
dependencies on a consumer device. If the release requires an unsupported runtime or architecture,
show a compatibility error before starting it.

## Release-scoped gateway and browser isolation

Do not navigate the tile directly to the service's random port. Add one Cozea-owned loopback gateway
with HTTP and WebSocket proxying.

Each release receives an origin such as:

```text
http://<content-hash>.localhost:<gateway-port>/
```

The gateway maps the validated host to the leased runtime, strips hop-by-hop headers, applies request
and body limits, and proxies HTTP upgrades. It rejects unknown release hosts and requests without an
active authorized lease.

Extend the `orgDevApp` navigation policy to allow only:

- the exact release gateway origin;
- the current immutable `cozea-devapp://` origin for static releases.

Top-level external HTTPS navigation continues to open in the system browser. The embedded browser
may reach HTTPS/WSS only when the release declares network permission. Browser storage partitions
stay publication-scoped, and CSP/permissions policy remain restrictive by default. Server-process
egress is disclosed but not enforceable until the sandbox milestone.

## Environment and secret UX

Before first service launch, compare the manifest requirements with device-local configuration.

- Required missing values block launch with a compact configuration sheet.
- Secret fields use secure inputs and are never displayed again.
- Values are encrypted through Electron `safeStorage` in an app-owned file, scoped by publication
  and variable name.
- The renderer receives only configured/missing booleans.
- Update and Remove actions are available from the DevApp's Settings page.
- Changing a value restarts only the affected publication runtime after confirmation.
- Optional non-secret values may have bounded publisher-provided defaults; secret defaults are
  prohibited.

Do not forward all host environment variables. Construct the child environment from a small runtime
base plus the manifest's approved entries.

## User interface

### Publish

- Identify the result as `Static DevApp` or `Service DevApp`.
- Show build, packaging, upload, verification, and activation stages.
- For a service release, show runtime compatibility, requested permissions, and required
  configuration names before publishing.
- Give actionable adapter errors, such as enabling Next.js standalone output.

### Store and launcher

- Add a small `Static` or `Service` label.
- Keep the organization badge and existing logo behavior.
- Opening a service app moves through Downloading, Configuration required, Starting, Ready, Failed,
  and Stopped states without rendering an empty tile.
- The first launch includes a trusted-code approval sheet with publisher identity and permissions.

### Tile

- Reuse the Org DevApp tile and native browser surface.
- Add Restart, Stop, and Logs actions for service releases.
- Closing the last tile starts a short idle timer; reopening during the timer reuses the process.
- A crashed runtime leaves the tile present with logs and Retry.
- A hidden tile does not stop a healthy runtime.

### Settings

- Show active release kind, version, publisher, permissions, runtime state, disk use, and local data
  use.
- Manage environment values.
- Clear cache separately from Clear local data.
- Archive remains organization-wide; stopping is device-local.

## IPC and shared contracts

Add typed IPC operations rather than extending generic terminal control:

- `orgDevApp:inspectBuild`
- `orgDevApp:buildAndUpload` with selected runtime kind
- `orgDevApp:prepareRelease`
- `orgDevApp:getRuntimeState`
- `orgDevApp:startRuntime`
- `orgDevApp:stopRuntime`
- `orgDevApp:restartRuntime`
- `orgDevApp:getRuntimeLogs`
- `orgDevApp:getConfigurationState`
- `orgDevApp:setConfigurationValue`
- `orgDevApp:removeConfigurationValue`
- `orgDevApp:approveRelease`
- `orgDevApp:clearCache`
- `orgDevApp:clearLocalData`

Every filesystem or runtime IPC handler resolves its release through authenticated renderer launch
metadata and main-process state. Renderer-supplied absolute paths, commands, ports, and executable
paths are never authority.

Update the launch spec with runtime kind and permission hash. Persist only identifiers and immutable
release metadata in workbench layout state; runtime status remains main-process state.

## Implementation sequence

### Phase 0: Freeze the static baseline

- Add regression fixtures for a static Vite app.
- Capture publish/open/cache/navigation/archive behavior in focused tests.
- Separate static-specific names in contracts without changing behavior.

Exit gate: all current static tests and a real static publish/open GUI pass remain green.

### Phase 1: Contracts and backend metadata

- Add the manifest validator and runtime-kind contracts.
- Extend Convex schema, publication mutations, consumer queries, and launch specs.
- Deploy Convex only after local schema/type/tests pass, using `bunx convex deploy`.

Exit gate: legacy releases resolve as static; malformed service metadata cannot be published.

### Phase 2: Build inspection and Next.js adapter

- Split build detection from build execution.
- Remove shell execution from organization publishing.
- Implement staging, Next standalone packaging, manifest generation, and service limits.
- Add cancellation and negative adapter diagnostics.

Exit gate: a fixture with SSR and an API route produces a reproducible, bounded service ZIP.

### Phase 3: Artifact preparation and cache leases

- Download and verify service artifacts.
- Validate manifest and platform after extraction.
- Add active leases, service quotas, atomic staging, crash cleanup, and pruning tests.

Exit gate: corruption, traversal, duplicate paths, oversized payloads, unsupported platforms, and
active-release eviction all fail safely.

### Phase 4: Runtime supervisor

- Add the service process state machine, runtime ownership, port allocation, environment filtering,
  health checks, logs, deduplicated starts, and verified shutdown.
- Wire app-quit and revocation cleanup.

Exit gate: concurrent starts produce one process; Stop removes the listener; crashes are observable;
no project or provider credentials appear in the child environment.

### Phase 5: Gateway and tile

- Add release-host routing and HTTP/WebSocket proxying.
- Extend navigation policy and publication-scoped browser session behavior.
- Implement tile lifecycle, retry, logs, restart, and idle lease behavior.

Exit gate: SSR, API routes, WebSockets, refresh/deep links, external navigation, two tiles, and app
restart work without exposing the raw service port.

### Phase 6: Configuration and trust UI

- Add encrypted device-local environment storage.
- Add configuration, first-run approval, permissions, publisher identity, and Settings controls.
- Bind approvals to content and permission hashes.

Exit gate: missing secrets block before spawn; secrets never enter renderer state, logs, Convex,
artifact files, or diagnostics.

### Phase 7: Additional adapters

- Add Nuxt, SvelteKit adapter-node, Remix/React Router, then the explicit generic Node adapter.
- Keep each adapter behind its own fixtures and compatibility checks.

Exit gate: each adapter passes publish on one Mac and clean download/open on a second-device profile.

### Phase 8: Hardening and release

- Add cache/data cleanup, resource ceilings, recovery after forced quit, and authorization refresh.
- Update English and Spanish copy, `docs/project-devapps.md`, `AGENTS.md`, and release notes.
- Run full typecheck, lint, tests, production build, and real Electron Computer Use scenarios.

Exit gate: the acceptance matrix below passes and the development stack is left running.

### Post-beta graduation: enforced server sandbox

- Evaluate an app-owned container or Virtualization.framework runtime with signed, reproducible
  images and no dependency on a user's Docker installation.
- Enforce filesystem mounts, outbound-network policy, process/resource ceilings, and descendant
  termination at that boundary.
- Only after those controls pass adversarial tests may the UI replace trusted-code disclosures with
  enforced permission language or broaden publishing beyond trusted organizations.

This milestone is not required for the private trusted-organization beta, but the beta gate and
wording cannot be removed before it lands.

## Test matrix

### Unit and contract

- Manifest parser accepts only canonical safe input.
- Adapter selection is deterministic and refuses ambiguous outputs.
- Artifact hash changes for every byte or manifest change.
- Permission-set hash is stable and order-independent.
- Runtime state transitions reject stale operation IDs.
- Environment filtering rejects reserved/injection names.
- Cache eviction respects active leases and quotas.
- Gateway host routing cannot cross publication boundaries.

### Integration

- Publish static Vite fixture and open from a clean cache.
- Publish Next service fixture with SSR, API route, deep link, and WebSocket.
- Open the same release in two tiles and observe one service process.
- Update the release while the previous release is running.
- Crash and restart the process.
- Cancel during build and upload.
- Remove org access while cached/running.
- Missing, updated, and removed secret configuration.
- Offline cached launch and uncached offline failure.
- Cache pressure while a release is active.
- Clear cache without clearing data; clear data only after explicit confirmation.

### Security

- ZIP traversal, symlink, case-collision, zip-bomb, duplicate-entry, and oversized-file fixtures.
- Manifest path traversal, shell syntax, unsupported runtime, architecture mismatch, and native-addon
  rejection.
- Renderer attempts to supply executable paths, ports, artifact paths, and foreign release IDs.
- Localhost navigation to any port other than the exact release gateway is blocked.
- Cross-publication cookies/storage and gateway host access are isolated.
- Secret values are absent from renderer snapshots, logs, crash reports, Convex, and workbench state.

### Real Electron acceptance

Using Computer Use rather than Playwright:

1. Publish and open an existing static DevApp.
2. Publish the Next.js service fixture.
3. Open it from a clean second-device profile in the organization.
4. Enter a required test secret and approve the trusted release.
5. Exercise SSR, API, deep navigation, reload, and WebSocket UI.
6. Hide and reopen the tile without stopping it.
7. Open a second tile and confirm process reuse.
8. Stop, restart, crash, and recover the service.
9. Publish an update and confirm data continuity with cache isolation.
10. Revoke organization access and confirm launch/download denial and runtime shutdown.

## Definition of done

- Static organization DevApps have no functional regression.
- A supported server-rendered application publishes as an immutable service artifact and opens on a
  clean authorized Mac without the source repo or dependency installation.
- No consumer-controlled shell command is executed.
- Runtime lifecycle is singleton, observable, recoverable, and verified on shutdown.
- Artifact, browser, gateway, environment, cache, and authorization boundaries have negative tests.
- Required configuration and trusted-code approval are usable entirely through the UI.
- Shared versus device-local data behavior is stated before publish and before first launch.
- Typecheck, lint, focused tests, production build, Convex deployment, and real Electron acceptance
  all pass, with any remaining warning explicitly documented.

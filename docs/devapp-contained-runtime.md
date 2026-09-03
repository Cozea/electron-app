# Published DevApp contained runtime

Phase 8 gives published workers and Node services an enforceable execution boundary. It does not
weaken local development: an unpublished DevApp remains trusted developer code, runs on the device
after explicit approval, and may use the full approved development capability set.

## Runtime choices

Every executable manifest uses version 2 and declares one placement/state pair:

| Manifest contract         | Runtime                                 | Durable writable state        | Local filesystem                          |
| ------------------------- | --------------------------------------- | ----------------------------- | ----------------------------------------- |
| `device` + `none`         | Per-workspace Linux VM on Apple silicon | None                          | Approved release-bound folder grants only |
| `device` + `device`       | Per-workspace Linux VM on Apple silicon | Publication-owned ext4 volume | Approved release-bound folder grants only |
| `hosted` + `none`         | Cloudflare Sandbox VM                   | None                          | Never                                     |
| `hosted` + `organization` | Cloudflare Sandbox VM                   | Publication-scoped R2 mount   | Never                                     |

`device` + `organization` and `hosted` + `device` are invalid. There is no child-process,
development-worker, or shell fallback when a selected runtime is unavailable.

Static-only packages do not start a runtime. A Node service necessarily has a network interface so
Cozea can reach its HTTP port; its published service part records that network contract. A
worker-only package receives outbound networking only when it declares `net.outbound`.

## Device runtime

On Apple-silicon macOS 26 or newer, Electron talks over bounded JSONL to a bundled Swift helper built
against Apple Containerization. The helper boots the exact signed Linux ARM64 image in its own
lightweight VM with:

- a read-only image root, a 4 GiB rootfs ceiling, and a 512 MiB writable-layer ceiling;
- 2 vCPUs, 1 GiB RAM, a 512-process ceiling, no Linux capabilities, and no-new-privileges;
- a minimal environment and direct argument-vector launch;
- a publication-owned ext4 image mounted at `/cozea/state` only for `state: device`;
- only explicit canonical VirtioFS grants mounted under `/cozea/grants/<grant-id>`.

The app bundle contains the helper, a digest-pinned Kata kernel, the digest-pinned Apple initfs
reference, and a resource manifest. Electron hashes the bundled helper and kernel against that
manifest before spawning, which detects a partial swap but cannot establish authenticity, since the
manifest sits in the same directory as the files it describes. A packaged macOS build therefore also
requires the helper to satisfy a code requirement pinned to the running application's own Apple
team, read from the host's signature rather than configured, so the check cannot be disabled by an
environment variable. An unsigned local build has no team to appeal to and falls back to the hash
alone. The helper receives only a fixed system `PATH`.

`prepare:devapp-runtime` ad-hoc signs the helper with `build/entitlements.mac.plist` — the same
plist electron-builder later inherits onto it — before recording its digest. Apple Containerization
opens a vmnet interface before any per-request branching, so without
`com.apple.security.virtualization` the helper cannot start a container of any kind, including one
that declared no network. `prepare:devapp-runtime:check` fails when that entitlement is absent. The exact release image is selected by OCI
manifest and ARM64 platform digests after Ed25519 attestation verification.

Device state is local to that Mac. Removing the final installed publication version deletes its
publication volume, exact cached images, approvals, folder grants, and encrypted environment
configuration after active runtimes stop. The same publication volume
cannot be mounted by two local runtime instances concurrently; a second workspace fails closed
instead of creating a misleading copy.

## Hosted runtime

Hosted placement uses Cloudflare Sandbox SDK `0.12.9`. One Sandbox durable object owns one outer
VM boundary. The pinned outer image runs rootless Docker-in-Docker with iptables disabled, matching
Cloudflare's documented arbitrary-image pattern. Cozea then pulls only the signed AMD64 platform
digest and starts the inner release with:

- read-only root, dropped capabilities, no-new-privileges, 512 PIDs, 2 CPUs, and 1 GiB RAM;
- a 256 MiB `tmpfs` at `/tmp`;
- deny-by-default egress, widened only for a declared service/network worker;
- no host path, source checkout, device credential, or registry credential inside the release;
- one exposed authenticated transport origin; services use a second independent token on that
  origin and are proxied to the unexposed inner service port.

The raw inner service port is never exposed. Electron reaches the authenticated transport proxy and
then routes it through the existing
authenticated, release-scoped `*.service.localhost` gateway, preserving the same browser origin and
navigation policy as a device service.

Organization state is mounted at `/cozea/state` from the `DEVAPP_ORG_STATE` R2 binding, scoped to:

```text
/organizations/<organization-id>/publications/<publication-id>
```

A stateful hosted publication has one durable Sandbox owner. Its active release runs one shared
runtime, and an active-release transition replaces the old runtime before mounting the same
publication state, so two release VMs cannot write that state concurrently. Cold starts are
serialized. Each desktop receives a distinct 90-second renewable control lease, so one client
cannot stop another. A crashed client stops renewing; expired leases are pruned, and the outer VM
is allowed to sleep after 15 minutes without activity. Runtime transport and per-client control
tokens are separate capabilities.

Cloudflare documents the Sandbox VM as the isolation boundary, R2 prefix mounts as the durable
storage mechanism, and custom wildcard hostnames as the production mechanism for exposed ports:
[architecture](https://developers.cloudflare.com/sandbox/concepts/architecture/),
[security](https://developers.cloudflare.com/sandbox/concepts/security/),
[storage](https://developers.cloudflare.com/sandbox/api/storage/), and
[exposed services](https://developers.cloudflare.com/sandbox/guides/expose-services/).

## Image and authorization chain

1. Electron rejects secret files/symlinks, requires a root `cozea-devapp.json`, deterministic build
   script, and committed `bun.lock`, then uploads a bounded immutable source ZIP.
2. Cloudflare binds the build to the authenticated device, project, organization, upload
   reservation, source digest, and package-manifest digest.
3. The protected GitHub builder builds Linux ARM64 and AMD64 images with pinned actions/base image,
   validates the declared executable entries after the build, emits SBOM and provenance, assembles
   an exact multi-platform manifest, and signs the canonical attestation with Ed25519. Native
   dependencies are allowed only when this build succeeds for both target architectures.
4. Convex activates only the registered successful build and stores the exact image authority on
   the immutable release.
5. Device and hosted launch both recheck release identity, signature, attestation, source digest,
   package-manifest digest, and exact platform digest. GHCR tags are never launch authority.
6. Cloudflare independently reauthorizes current device and organization membership against the
   active release before every hosted start. The main process uses a build-pinned gateway origin;
   renderer IPC cannot choose where a device bearer token is sent.

## Known gap: registry credentials and image tenancy

Published DevApps that need the device runtime cannot currently start. Publishing, signing,
cataloguing and installing all succeed; the image pull is what fails, so the failure surfaces only
when the DevApp is first opened.

**Confirmed cause.** The Worker completes the GHCR token exchange itself, using Basic credentials,
and returns the resulting bearer token to the device. The device treats that finished token as a
*credential* and replays it at `https://ghcr.io/token`, which expects Basic. GHCR answers `401`
with its own `WWW-Authenticate` header, and Containerization refuses the exchange:

```
refusing insecure credential exchange:
authorization server https://ghcr.io/token issued its own authentication challenge
```

The token is spent at the wrong step. It is not a scope, expiry, or visibility problem.

**Why the device cannot simply skip the exchange.** `ImageStore.pull` exposes only
`auth: Authentication`, and that value is consumed exclusively inside `fetchToken`; it is never
applied to the `/v2/` request. `RegistryClient.request` does accept arbitrary headers, but it is
`internal`. Handing the client a pre-exchanged token would require forking Containerization.

**Why the package cannot simply be made public.** Every organization publishes into one shared
repository, `ghcr.io/cozea/devapps`. Making it public would expose every organization's DevApp
images, not just this project's own.

**Related: the pull grant is broader than the pull decision.** `handleCreateDevAppRuntimePull`
authorizes a specific organization, publication, release and digest, then returns a token scoped to
`repository:cozea/devapps:pull` — the entire shared repository. For that token's lifetime a device
authorized for one DevApp holds a credential able to pull any organization's image, given a digest.

**Planned direction.** Publish each organization to its own repository under
`ghcr.io/cozea/devapps/<organizationId>`, so a pull token can be scoped to exactly what was
authorized. `isDigestPinnedImageReference` does not constrain the repository path and
`finalize-devapp-runtime-build.ts` already takes `--repository`, so the reference plumbing carries
this unchanged. Once the scope is per-organization, the device can hold a short-lived Basic
credential — the form GHCR's token endpoint actually accepts — without that credential reaching
beyond a single organization's images.

## Filesystem and developer power

Published hosted code cannot access local files. Use a normal HTTPS service or an explicit upload
flow. Published device code should prefer the capability broker for project/file operations. If a
real filesystem is necessary, the user may grant one canonical folder, read-only or read-write, to
one exact publication/release for a bounded duration. Agents and workers cannot create or widen a
grant.

Development previews are intentionally different. They continue to run in the local utility
process after an explicit expiring approval and can use every implemented capability the user
approved. Node permission flags are defense in depth there, not an OS sandbox.

The downloadable release artifact is not a second executable runtime. Static UI bytes remain in
the artifact, while a Node service artifact contains only its generated configuration and an inert
entry marker. Executable worker/service bytes come exclusively from the verified signed image.
Worker-only packages receive a small administrative tile so the user can approve, monitor, and stop
their contained runtime without inventing a view in package code.

## Agent tools

The authenticated T3 host exposes a catalog and invoke operation separately. Invocation requires
an exact installed release, a living contained runtime, a declared tool, matching workspace and
release, an unexpired `agentInvocable` grant, schema-valid input, an available concurrency slot,
and a bounded timeout/result. Main rechecks all of these at call time. User revocation or runtime
exit removes the endpoint; the agent cannot approve code, create folder grants, or change placement.

## Production configuration

The hosted path requires these Cloudflare bindings/configuration:

- Durable Object/container binding `DEVAPP_SANDBOX` using `Dockerfile.devapp-sandbox`;
- R2 buckets `DEVAPP_BUILD_INPUTS` and `DEVAPP_ORG_STATE`;
- a production wildcard hostname in `DEVAPP_SANDBOX_PREVIEW_HOSTNAME` routed to this Worker;
- `COZEA_RUNTIME_SIGNING_PUBLIC_KEY`, matching the desktop bundle and protected builder key;
- `DEVAPP_IMAGE_REGISTRY_USERNAME` and pull-only `DEVAPP_IMAGE_REGISTRY_TOKEN`;
- existing builder dispatch/callback secrets and Convex server authorization.

The GitHub workflow requires `COZEA_DEVAPP_BUILDER_GATEWAY_URL`,
`COZEA_DEVAPP_BUILDER_CALLBACK_TOKEN`, and `COZEA_RUNTIME_SIGNING_PRIVATE_KEY`. Do not print these
values. The public key installed in Cloudflare, the desktop runtime metadata, and the private key in
the protected builder must be one keypair.

Before promotion:

```sh
bun run devapp:check
bun run prepare:devapp-runtime:check
bun run typecheck:cloudflare
bunx wrangler deploy --config cloudflare/worker/wrangler.jsonc --dry-run --containers-rollout=none
bun run dist:local
```

The dry run validates the Worker bundle and bindings without mutating Cloudflare. A real deploy,
bucket creation, secret installation, wildcard DNS/route setup, and a real signed two-platform
publish/start are explicit operator actions; source verification does not pretend they occurred.

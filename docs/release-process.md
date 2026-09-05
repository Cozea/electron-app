# Desktop Release Process

This app supports two desktop release paths:

- GitHub Actions tag releases that publish to GitHub Releases in `Cozea/cozea-prod`.
- CircleCI main-branch releases that build on hosted macOS/Windows runners and upload update assets to Cloudflare R2.

## Release Model

- `main` should stay releasable.
- Git tags are the source of truth for release candidates.
- A pushed tag matching `v*` publishes installers and runtime assets to `Cozea/cozea-prod` via GitHub Actions.
- A push to `main` can publish the latest desktop update feed via CircleCI when the CircleCI project and `cozea-release` context are configured.
- Manual dispatch is for rebuilding or validating an existing tag before publishing it.
- We only use three product lanes: `canary`, `beta`, and `stable`.

## Channel Rules

- `stable`: use a plain semver tag like `v0.2.1`
- `beta`: use a prerelease tag like `v0.3.0-beta.1`
- `canary`: use a prerelease tag like `v0.3.0-canary.1`

For updater compatibility, Electron Builder's official channel ladder is `latest`, `beta`, and `alpha`, so this workflow maps:

- `stable` -> updater channel `latest`
- `beta` -> updater channel `beta`
- `canary` -> updater channel `alpha`

`beta` and `canary` releases are published as GitHub prereleases in the GitHub Actions path. The CircleCI path currently publishes the `latest` updater channel to Cloudflare R2.

## Workflow Shape

### GitHub Actions

The GitHub Actions workflow lives at `.github/workflows/release.yml` and runs in three stages:

1. `plan`
   Resolves the tag, checkout ref, release lane, updater channel, and publish mode.
2. `verify`
   Runs dependency install, runtime metadata preparation, typecheck, and lint on Linux before any platform packaging starts.
3. `build`
   Packages signed desktop artifacts per platform and publishes only when the workflow is in publish mode.

### CircleCI + Cloudflare R2

The CircleCI workflow lives at `.circleci/config.yml` and runs in four stages:

1. `verify`
   Installs dependencies, prepares runtime metadata, typechecks, and lints.
2. `build_macos_universal`
   Builds a signed universal macOS DMG/ZIP, notarizes/staples the DMG, verifies the app signature, and persists artifacts.
3. `build_windows_x64`
   Builds the Windows x64 NSIS installer and persists artifacts.
4. `upload_cloudflare_r2`
   Uploads generated updater metadata, installers, and blockmaps to Cloudflare R2.

CircleCI builds use Electron Builder's `generic` provider by setting:

- `COZEA_UPDATE_PROVIDER=generic`
- `COZEA_UPDATE_BASE_URL=https://updates.cozea.app` or the active update host
- `COZEA_UPDATER_CHANNEL=latest`

The app then checks:

```text
https://updates.cozea.app/latest/latest-mac.yml
https://updates.cozea.app/latest/latest.yml
```

## Supported Triggers

### Stable release

Push a tag like `v0.2.1`.

### Beta release

Push a tag like `v0.3.0-beta.1`.

### Canary release

Push a tag like `v0.3.0-canary.1`.

### Manual dry run

Run `Desktop Release` from Actions with:

- `release_tag`: an existing remote tag
- `publish`: `false`

This rebuilds the tagged release candidate without pushing installers.

### Manual republish

Run `Desktop Release` from Actions with:

- `release_tag`: an existing remote tag
- `publish`: `true`

Use this only when you need to republish the exact same tag contents.

### Main release through CircleCI

Push to `main` after updating `package.json` to a new version. CircleCI uploads artifacts to the `latest` Cloudflare R2 channel.

Auto-update clients only install versions newer than their installed version, so main releases still require an intentional version bump before publishing.

### Local package smoke test

Run `bun run dist:local` to assemble the production application and installers without publishing. This path deliberately disables macOS signing and notarization so contributors without Cozea's release certificate can validate packaged resources locally. It is not a releasable artifact; every GitHub Actions, CircleCI, and `bun run release` build still requires the normal signing identity.

## CircleCI Configuration

Create a CircleCI context named `cozea-release` with these environment variables:

- `VITE_CONVEX_URL`
- `VITE_AI_API_URL`
- `COZEA_UPDATE_BASE_URL`
- `COZEA_UPDATE_BUCKET`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `COZEA_RUNTIME_SIGNING_PRIVATE_KEY` or `COZEA_RUNTIME_SIGNING_PRIVATE_KEY_PATH` when runtime metadata signing is enabled
- `COZEA_RUNTIME_SIGNING_PUBLIC_KEY` when runtime metadata verification material needs to be regenerated

`CSC_LINK` may be a URL, `file://` path, local path on the runner, or base64/base64-prefixed P12 payload. For CircleCI, prefer a masked base64 secret.

The Cloudflare API token must be able to upload objects into the configured R2 bucket.

## Operating Rules

GitHub collaboration generation 3 has two release gates: the desktop build flag
`VITE_GITHUB_COLLABORATION_RELEASE=1` and the production Convex environment flag
`COLLABORATION_G3_CREATE_ENABLED=1`. Leave both disabled while implementation and
acceptance are incomplete. Existing ordinary-project synchronization remains on.
The completion checklist is in `docs/collaboration-v2-completion.md`.

The collaboration rollout requires a reviewed collaboration-only reset inventory,
compatible production Convex functions/schema (`bunx convex deploy`), the gateway,
and then the packaged desktop build. Two independently authenticated packaged
instances must pass the deployed workflow before general enablement. Rollback
turns off new session creation and retains all unpublished local recovery data.

- Do not publish GitHub Release artifacts from branches.
- Do not rebuild a release from code that is not already tagged.
- Do not publish a CircleCI main release without a version bump.
- Do not introduce channels other than `canary`, `beta`, and `stable` without updating the release model intentionally.
- Keep release secrets limited to signing and publishing steps.
- Delete merged stale branches regularly so the release surface stays easy to reason about.

## Active conversations during a controlled update

The update menu's **Continue active chats after updates** preference is off by
default and applies to an explicit install-now action. Electron requests durable
preparation from every active workspace's shadow/T3 server and awaits all replies
before calling the updater. Failed preparation or installer handoff cancels all
requests and retains the downloaded update for retry. Preparations expire after
30 seconds if the old server stays alive.

The replacement pinned T3 runtime owns continuation reconciliation; the renderer
only reconnects. Native instance/thread/marked-turn identity remains authoritative.
Ordinary quit, renderer reload and unexpected crashes do not create markers. Do
not claim exactly-once external tool execution across an ambiguous crash.

Before a candidate release, run `bun run check:provider-compatibility`,
`bun run test:provider-compatibility`, ordinary root checks, portable runtime
preparation and built-shadow smoke. Confirm the fork gitlink is fetchable from
Cozea/t3code before publishing a parent ref. Keep the protocol and native-runtime
qualification record in `shared/provider-compatibility.json` current. Live signed
updater replacement and fresh/upgrade packaged profiles still require the release
matrix; unit tests of the handshake do not qualify the updater itself.


## Collaboration-safe quit and update verification

Renderer collaboration queues veto window unload while edits are awaiting durable
main-process acceptance. Do not override Electron's `will-prevent-unload` event.
Cancelable `before-quit` must not dispose the collaboration host, workspace
catalog, or native runtime. Once all windows accept unload, `will-quit` first
awaits session recovery and scoped native shutdown, then disposes the remaining
owners. Failed preparation retains recovery and exposes a retry; partial disposal
is retried without preparing an already disposed host again.

Native Stop/Interrupt remains available after role removal, but Interrupt must
not recover or launch an inactive provider. Shutdown acknowledges actual child
exit and drains in-flight encrypted receive callbacks before releasing storage.
Unrelated workspaces are not part of a session-scoped stop. The maintained T3
source overlay is required in fresh and packaged runtime preparation.

The existing controlled-update continuation contract still requires packaged
verification with this quit ordering. A green Linux build is not an installer or
macOS/Windows lifecycle acceptance result. Run cancel-close, failed persistence,
failed native stop, last-window-close, ordinary Quit, update preparation and
failed-update-handoff scenarios on the packaged candidate. Keep both GitHub
collaboration release gates disabled until all code blockers in
`collaboration-v2-completion.md` and the deployed two-device matrix are closed.

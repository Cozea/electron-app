# Desktop Release Process

Desktop releases are built by GitHub Actions from tags and published to GitHub Releases in `Cozea/cozea-prod`.

## Release Model

- `main` should stay releasable.
- Git tags are the source of truth for release candidates.
- A pushed tag matching `v*` publishes installers and runtime assets to `Cozea/cozea-prod` via GitHub Actions.
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

`beta` and `canary` releases are published as GitHub prereleases.

## Workflow Shape

### GitHub Actions

The GitHub Actions workflow lives at `.github/workflows/release.yml` and runs in three stages:

1. `plan`
   Resolves the tag, checkout ref, release lane, updater channel, and publish mode.
2. `verify`
   Runs dependency install, runtime metadata preparation, typecheck, and lint on Linux before any platform packaging starts.
3. `build`
   Packages signed desktop artifacts per platform and publishes only when the workflow is in publish mode.

The macOS signing resolution step emits `signing=1` when certificate credentials
are configured, otherwise `signing=0` (also used by forced-unsigned builds).
Publish-secret validation, certificate import, and notarization consume this step
output. The job starts with `COZEA_MAC_SIGNING=0`; resolution also exports the final
value for build commands.

### Generic update host

`apps/desktop/electron-builder.config.cjs` can also target a self-hosted update feed
by setting `COZEA_UPDATE_PROVIDER=generic` and `COZEA_UPDATE_BASE_URL`. No pipeline
uses it today; releases default to the GitHub provider.

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

### Local package smoke test

Run `bun run dist:local` to assemble the production application and installers without publishing. This path deliberately disables macOS signing and notarization so contributors without Cozea's release certificate can validate packaged resources locally. It is not a releasable artifact; every GitHub Actions and `bun run release` build still requires the normal signing identity.

## Operating Rules

- Do not publish GitHub Release artifacts from branches.
- Do not rebuild a release from code that is not already tagged.
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

## Computer Use native runtime

macOS builds must package the ABI 2 addon, `libCozeaComputerUseBridge.dylib`, the adjacent `CozeaComputerUseRuntime_CozeaComputerUseCore.bundle` tool resource, license and manifest. Use `bun run prepare:computer-use` and `bun run prepare:computer-use:check` before signing. Non-Mac builds contain an unsupported manifest, not a worker. Run the signed-app live validation matrix in `docs/computer-use-v2.md` before release; unit tests and headless CI do not establish TCC permission identity, private SkyLight compatibility, cursor smoothness or latency on a user's desktop.

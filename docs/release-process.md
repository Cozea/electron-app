# Desktop Release Process

All desktop releases are built, packaged, and published exclusively via **GitHub Actions** to GitHub Releases in the distribution repository (`Cozea/cozea-prod`). Application installers and in-app auto-updates are downloaded directly from GitHub Releases.

## Release Model

- `main` should stay releasable.
- Git tags are the source of truth for release candidates.
- A pushed tag matching `v*` triggers the release workflow in `.github/workflows/release.yml` and publishes installers, runtime assets, and updater feeds to `Cozea/cozea-prod`.
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

`beta` and `canary` releases are published as GitHub prereleases in `Cozea/cozea-prod`. Stable releases are published as standard GitHub releases.

## Workflow Shape

The GitHub Actions workflow lives at `.github/workflows/release.yml` and runs in five stages:

1. `plan`
   Resolves the tag, checkout ref, release lane, updater channel, and publish mode (`always` on tag push, selectable on manual dispatch).
2. `verify`
   Runs dependency install, verifies package version matches tag, runs runtime metadata preparation, typecheck, and lint on Linux before platform packaging starts.
3. `stage`
   Creates the target GitHub Release record in `Cozea/cozea-prod` idempotently so parallel build jobs can publish into an existing release without racing.
4. `build`
   Packages signed desktop artifacts per platform (macOS arm64 and macOS x64), signs and notarizes bundles and DMGs, verifies code signatures, uploads platform installers (DMG/ZIP) and runtime assets to the GitHub Release, and captures per-architecture updater feeds.
5. `updates`
   Merges the architecture-specific updater feeds into a unified feed via `scripts/merge-updater-feed.mjs` and uploads it directly to the release in `Cozea/cozea-prod`.

Publish configuration in `electron-builder.yml` and `apps/desktop/electron-builder.config.cjs` uses Electron Builder's `github` provider:

- Provider: `github`
- Owner: `Cozea`
- Repo: `cozea-prod`
- Channel: resolved per lane (`latest`, `beta`, `alpha`)

The app's built-in `autoUpdater` queries `Cozea/cozea-prod` releases on GitHub to detect, download, and install updates.

## Supported Triggers

### Stable release

Push a tag like `v0.2.1`:

```shell
git tag v0.2.1
git push origin v0.2.1
```

### Beta release

Push a tag like `v0.3.0-beta.1`:

```shell
git tag v0.3.0-beta.1
git push origin v0.3.0-beta.1
```

### Canary release

Push a tag like `v0.3.0-canary.1`:

```shell
git tag v0.3.0-canary.1
git push origin v0.3.0-canary.1
```

### Manual dry run

Run `Desktop Release` from GitHub Actions with:

- `release_tag`: an existing remote tag
- `publish`: `false`

This rebuilds the tagged release candidate without publishing installers to GitHub Releases.

### Manual republish

Run `Desktop Release` from GitHub Actions with:

- `release_tag`: an existing remote tag
- `publish`: `true`

Use this only when you need to republish the exact same tag contents.

### Local package smoke test

Run `bun run dist:local` to assemble the production application and installers without publishing. This path deliberately disables macOS signing and notarization so contributors without Cozea's release certificate can validate packaged resources locally. It is not a releasable artifact; every GitHub Actions and `bun run release` build still requires the normal signing identity.

## Required GitHub Actions Configuration

Set these secrets and variables in GitHub Actions for `Cozea/electron-app`:

- `GH_TOKEN`: Personal access token with permissions to create and upload releases in `Cozea/cozea-prod`
- `APPLE_ID`: Apple ID for notarization
- `APPLE_APP_SPECIFIC_PASSWORD`: App-specific password for notarization
- `APPLE_TEAM_ID`: 10-character Apple Developer Team ID
- `CSC_LINK`: Base64-encoded Developer ID Application `.p12` certificate (or secure URL/file path)
- `CSC_KEY_PASSWORD`: Password for the `.p12` certificate
- `VITE_CONVEX_URL`: Production Convex URL
- `VITE_AI_API_URL`: AI API gateway URL
- Optional: `COZEA_RUNTIME_SIGNING_PRIVATE_KEY` or `COZEA_RUNTIME_SIGNING_PRIVATE_KEY_PATH` for signing runtime metadata

## Operating Rules

- Do not publish GitHub Release artifacts from branch pushes directly; push a git tag `v*`.
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

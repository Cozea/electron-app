# Desktop Release Process

This app supports two desktop release paths:

- GitHub Actions tag releases that publish to GitHub Releases in `Cozea/cozea-prod`.
- CircleCI main-branch releases that build on hosted macOS/Windows runners and upload update assets to Cloudflare R2.
- Codemagic main-branch releases that build on hosted macOS/Windows runners and upload update assets to Cloudflare R2.

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
2. `build_macos_separate`
   Builds signed separate macOS x64 and arm64 DMG/ZIP artifacts in one Electron Builder invocation, notarizes/staples the DMGs, verifies app signatures, and persists artifacts.
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

The macOS updater metadata is generated from the combined x64/arm64 macOS build, but the installers remain separate. Do not split macOS x64 and arm64 into independent CircleCI jobs unless the upload path also prevents `latest-mac.yml` from being overwritten.

### Codemagic + Cloudflare R2

The Codemagic workflow lives at `codemagic.yaml` and provides a CircleCI replacement when CircleCI credits are unavailable.

Codemagic runs two main-branch workflows:

1. `release-macos-r2`
   Builds signed separate macOS x64 and arm64 DMG/ZIP artifacts in one workflow, notarizes/staples the DMGs, verifies app signatures, and uploads macOS artifacts to Cloudflare R2.
2. `release-windows-r2`
   Builds the Windows x64 NSIS installer and uploads Windows artifacts to Cloudflare R2.

Both workflows import the same `cozea-release` environment variable group and upload directly into the configured R2 channel. There is no cross-workflow artifact handoff in Codemagic, so each platform workflow uploads its own artifacts.

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

## Codemagic Configuration

Add the repository in Codemagic and enable `codemagic.yaml` builds. Create a Codemagic environment variable group named `cozea-release` with the same values used by CircleCI:

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

Codemagic workflows are triggered by pushes to `main`. If webhooks are not installed automatically, update the repository webhook from the Codemagic app settings.

## Operating Rules

- Do not publish GitHub Release artifacts from branches.
- Do not rebuild a release from code that is not already tagged.
- Do not publish a CircleCI main release without a version bump.
- Do not introduce channels other than `canary`, `beta`, and `stable` without updating the release model intentionally.
- Keep release secrets limited to signing and publishing steps.
- Delete merged stale branches regularly so the release surface stays easy to reason about.

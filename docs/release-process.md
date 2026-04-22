# Desktop Release Process

This app uses a tag-first desktop release model.

## Release Model

- `main` should stay releasable.
- Git tags are the source of truth for release candidates.
- A pushed tag matching `v*` publishes installers and runtime assets to `Cozea/cozea-prod`.
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

`beta` and `canary` releases are published as GitHub prereleases. `stable` releases are published as full releases.

## Workflow Shape

The GitHub Actions workflow lives at `.github/workflows/release.yml` and runs in three stages:

1. `plan`
   Resolves the tag, checkout ref, release lane, updater channel, and publish mode.
2. `verify`
   Runs dependency install, runtime metadata preparation, typecheck, and lint on Linux before any platform packaging starts.
3. `build`
   Packages signed desktop artifacts per platform and publishes only when the workflow is in publish mode.

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

## Operating Rules

- Do not publish from branches.
- Do not rebuild a release from code that is not already tagged.
- Do not introduce channels other than `canary`, `beta`, and `stable` without updating the release model intentionally.
- Keep release secrets limited to signing and publishing steps.
- Delete merged stale branches regularly so the release surface stays easy to reason about.

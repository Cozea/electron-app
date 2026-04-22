# Desktop Release Process

This app uses a tag-first desktop release model.

## Release Model

- `main` should stay releasable.
- Git tags are the source of truth for release candidates.
- A pushed tag matching `v*` publishes installers and runtime assets to `Cozea/cozea-prod`.
- Manual dispatch is for rebuilding or validating an existing tag before publishing it.

## Workflow Shape

The GitHub Actions workflow lives at `.github/workflows/release.yml` and runs in three stages:

1. `plan`
   Resolves the tag, checkout ref, and publish mode.
2. `verify`
   Runs dependency install, runtime metadata preparation, typecheck, and lint on Linux before any platform packaging starts.
3. `build`
   Packages signed desktop artifacts per platform and publishes only when the workflow is in publish mode.

## Supported Triggers

### Stable release

Push a tag like `v0.2.1`.

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
- Keep release secrets limited to signing and publishing steps.
- Delete merged stale branches regularly so the release surface stays easy to reason about.

Place bundled Git runtimes here before packaging release builds.

Required layout:
- build/git/darwin-arm64/bin/git
- build/git/darwin-x64/bin/git
- build/git/win32-x64/cmd/git.exe
- build/git/win32-arm64/cmd/git.exe

These binaries are loaded from process.resourcesPath/git/<platform>-<arch>/...
at runtime. They must be signed/notarized as required for release.

Automation:
- `npm run prepare:bundled-git` hydrates required runtime(s) before release packaging.
- `npm run prepare:bundled-git:check` validates required runtime(s) only.
- `npm run dist` now runs `predist` automatically, which calls `prepare:bundled-git`.
- Default target selection is host-native only.

Archive source env vars:
- `COZEA_GIT_BUNDLE_URL_DARWIN_ARM64`
- `COZEA_GIT_BUNDLE_URL_DARWIN_X64`
- `COZEA_GIT_BUNDLE_URL_WIN32_X64`
- `COZEA_GIT_BUNDLE_URL_WIN32_ARM64`
- Each value can be an `https://...` archive URL or an absolute local archive path.

Behavior:
- If a required Windows bundle is missing and no env var is set, the script auto-downloads MinGit from the latest Git for Windows release feed.
- If a required native macOS bundle is missing and no env var is set, the script auto-builds Git from the latest `git/git` source release.
- Non-native macOS bundles (for example building `darwin-x64` from an `arm64` Mac) still require `COZEA_GIT_BUNDLE_URL_*`.
- Set `COZEA_GIT_BUNDLE_REQUIRE=all` to enforce all four platform bundles in one run.
- Set `COZEA_GIT_BUNDLE_TARGETS` (comma-separated) to prepare/check an explicit subset.
  Example: `COZEA_GIT_BUNDLE_TARGETS=win32-x64,win32-arm64 npm run prepare:bundled-git`

Prerequisites for macOS auto-build:
- Xcode Command Line Tools (`xcode-select --install`)
- `make`, `tar`, and standard build toolchain available on PATH

Dev-mode testing:
- `npm run dev:bundled-git` runs dev with bundled-Git mode forced (`COZEA_FORCE_BUNDLED_GIT=1`).
- `COZEA_BUNDLED_GIT_ROOT=/absolute/path/to/git-root npm run dev:bundled-git` overrides root lookup.
- `COZEA_GIT_EXECUTABLE=/absolute/path/to/git npm run dev` pins a specific Git executable.

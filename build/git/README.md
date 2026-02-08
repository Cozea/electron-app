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

Archive source env vars:
- `COZEA_GIT_BUNDLE_URL_DARWIN_ARM64`
- `COZEA_GIT_BUNDLE_URL_DARWIN_X64`
- `COZEA_GIT_BUNDLE_URL_WIN32_X64`
- `COZEA_GIT_BUNDLE_URL_WIN32_ARM64`
- Each value can be an `https://...` archive URL or an absolute local archive path.

Behavior:
- If a required Windows bundle is missing and no env var is set, the script auto-downloads MinGit from the latest Git for Windows release feed.
- macOS bundles must come from configured archive URLs or already-present files in this folder.
- Set `COZEA_GIT_BUNDLE_REQUIRE=all` to enforce all four platform bundles in one run.

Dev-mode testing:
- `npm run dev:bundled-git` runs dev with bundled-Git mode forced (`COZEA_FORCE_BUNDLED_GIT=1`).
- `COZEA_BUNDLED_GIT_ROOT=/absolute/path/to/git-root npm run dev:bundled-git` overrides root lookup.
- `COZEA_GIT_EXECUTABLE=/absolute/path/to/git npm run dev` pins a specific Git executable.

Place bundled Git runtimes here before packaging release builds.

Required layout:
- build/git/darwin-arm64/bin/git
- build/git/darwin-x64/bin/git
- build/git/win32-x64/cmd/git.exe
- build/git/win32-arm64/cmd/git.exe

These binaries are loaded from process.resourcesPath/git/<platform>-<arch>/...
at runtime. They must be signed/notarized as required for release.

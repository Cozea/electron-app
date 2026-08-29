# T3 runtime preparation and packaging

Date: 2026-08-29
Pin: `docs/substrate-t3-pin.md` (`d830df40`)

Cozea runs its pinned T3 assistant server as a separate local process. The
source tree preserves T3 as a direct Git submodule and keeps its pnpm workspace
separate from Cozea's Bun workspace.

## First run

From a fresh source checkout, run one command:

```shell
bun run bootstrap
```

This installs the Cozea workspace, initializes only `vendor/t3code`, installs
the vendor with the pnpm version declared by the vendor, and builds
`apps/server/dist/bin.mjs`. `bun run dev` invokes the same T3 preparation step
automatically and skips it when the bundle is already valid for the current
parent gitlink.

The root install deliberately uses `--ignore-scripts`, then runs Cozea's root
`postinstall` explicitly. This avoids the vendored `@cozea/effect-acp` prepare
hook whose generator dependency is intentionally unavailable while preserving
Cozea's required native-permission and Effect patch steps.

Do not use `git submodule update --recursive`. The T3 tree contains an upstream
nested gitlink without a `.gitmodules` mapping. It is unrelated to the Cozea
server, and recursive checkout fails after downloading unnecessary data.

## Layout

| Path | Role |
| --- | --- |
| `vendor/t3code` | Direct Git submodule at the required pin |
| `scripts/prepare-t3-runtime.mjs` | Idempotent checkout, install, build, check, and portable deployment |
| `scripts/vendor/sync-t3code-pin.mjs` | Explicitly synchronize the checkout to the documented pin |
| `scripts/vendor/sync-t3-contracts.mjs` | Sync selected T3 contracts into `packages/contracts/src/t3/` |
| `scripts/spike-t3-server-boot.mjs` | Server boot and RPC smoke outside Electron |
| `apps/server/` | Cozea wrapper that starts the prepared T3 server |
| `build/t3-runtime` | Generated portable production deployment included by Electron Builder |

## Package managers

| Area | Tool | Notes |
| --- | --- | --- |
| Cozea repository | **Bun** | Root install, scripts, Electron, and Vite |
| `vendor/t3code` | **pnpm** (+ `vp` / Vite+) | Version is read from the vendor's `packageManager` field |

The T3 server requires Node.js 22.16 or newer. Packaged Cozea can reuse
Electron's embedded Node runtime; source development uses the current Node
executable or an explicit `COZEA_T3_NODE` override.

## Commands

```shell
# Initialize and build only when required
bun run prepare:t3-runtime

# Read-only validation of the pin and loadable development bundle
bun run prepare:t3-runtime:check

# Force dependency installation and rebuilding
node scripts/prepare-t3-runtime.mjs --force

# Build the production-only portable runtime under build/t3-runtime
bun run prepare:t3-runtime:package

# Exercise the prepared server outside Electron
node scripts/spike-t3-server-boot.mjs
```

The packaging command uses pnpm's legacy deploy mode because this upstream
workspace does not enable injected workspace packages. The resulting portable
directory contains the server bundle and production dependencies, including
the platform-native PTY and file-finder modules; it does not contain the full
T3 development workspace. Preparation renames pnpm's hidden virtual store to
`pnpm-store` and retargets its direct links because Electron Builder excludes
dot-directories from application resources.

## CI and releases

CircleCI and GitHub release jobs check out the direct submodule. The root
`predist` hook builds the portable runtime, and Electron Builder copies it to
the application's `t3-runtime` resources directory. Packaging fails if the
submodule, bundle, or production deployment is invalid, preventing an
assistant-less installer from being published.

## Updating the pin

1. Choose and push a SHA on `Cozea/t3code`.
2. Update the `vendor/t3code` gitlink, `docs/substrate-t3-pin.md`, this document, and `apps/desktop/electron/substrate/constants.ts`.
3. Run `bun run prepare:t3-runtime`.
4. Regenerate selected contracts only when their upstream sources changed.
5. Run the boot smoke, full checks, and `bun run prepare:t3-runtime:package`.
6. Commit the parent gitlink, pin metadata, generated changes, and wrapper changes together.

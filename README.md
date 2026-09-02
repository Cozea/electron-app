# Cozea

A collaborative, AI-assisted development environment, built as an Electron desktop
application.

> **Status: alpha (v0.2.0).** Interfaces, on-disk formats, and the DevApp contract are
> still changing between releases. Expect breaking changes.

## What it is

Cozea is a desktop workspace for working on software with AI assistants. Beyond the
editor and assistant surfaces, it hosts **DevApps** — small applications that run
inside the workspace, are published to an organization catalog, and are installed by
other members of that organization.

DevApps come in two tiers, and the distinction is deliberate:

- **Development DevApps** run with your own privileges on your own machine. They are
  the powerful tier, and they stay that way.
- **Published DevApps** run inside an app-owned container boundary with a read-only
  root filesystem and an explicit capability grant. A published DevApp cannot reach
  anything it was not granted.

## Requirements

| | |
|---|---|
| Bun | `1.4.0` (pinned via `packageManager`) |
| Node | 22 |
| Platform | macOS or Windows to run; **macOS 26+** for contained DevApps |

Windows builds are produced (NSIS), but the contained DevApp runtime is built on Apple's
Containerization framework and declares `.macOS(.v26)`. Elsewhere those surfaces are
unavailable rather than degraded — development DevApps still work.

## Getting started

The build depends on a vendored submodule, so clone recursively:

```bash
git clone --recurse-submodules https://github.com/Cozea/electron-app.git
cd electron-app
bun install
bun run dev
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init vendor/t3code
```

`bun run dev` prepares the vendored runtime and the native helpers before starting the
app. The first run builds the vendored server bundle and takes considerably longer than
subsequent ones; after that a stamp file lets it skip the rebuild while the pin is
unchanged.

Copy `.env.example` to `.env` and fill in your own backend endpoints. The repository
does not ship credentials, and no deployment is named in tracked files.

## Layout

| Path | Contents |
|---|---|
| `apps/desktop` | The Electron application — main process, preload, renderer |
| `packages` | Publishable workspace packages, including the DevApp SDK |
| `shared` | Types and logic shared across the main/renderer boundary |
| `convex` | Backend schema and functions |
| `cloudflare` | Worker for collaboration transport and DevApp build orchestration |
| `native` | Swift helpers: container runtime, automation, preview |
| `vendor/t3code` | Vendored editor substrate (submodule; see `docs/substrate-t3-pin.md`) |
| `docs` | Architecture notes, plans, and the DevApp authoring guide |

## Development

```bash
bun run typecheck     # renderer
bun run lint
bun run test
bun run dist          # package a local build
```

`docs/devapp-authoring.md` is the entry point for writing a DevApp, and
`docs/devapp-runtime-contract.md` specifies the runtime boundary that published
DevApps execute within.

### The vendored substrate

`vendor/t3code` is pinned, and the pin is recorded in **two** places that must move
together: the parent gitlink and the SHA in `docs/substrate-t3-pin.md`. The sync script
treats the document as the source of truth, so bumping only the gitlink will be
silently reverted on the next sync. Run `bun run prepare:t3-runtime` after any bump,
and never pin to a commit that has not been pushed.

## License

Copyright (C) 2025-2026 Ramuse LLC.

Licensed under the **GNU Affero General Public License v3.0 or later**. See
[LICENSE](LICENSE) for the full text.

The AGPL's network clause applies: if you run a modified version of this software and
make it available to users over a network, you must offer those users the corresponding
source of your modified version.

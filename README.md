<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/desktop/public/logos/logo_dark_mode.png">
  <img src="apps/desktop/public/logos/logo_light_mode.png" alt="Cozea" width="88">
</picture>

<h1>Cozea</h1>

<p><strong>A collaborative, AI-assisted development environment,<br>built as an Electron desktop application.</strong></p>

<p>
  <img alt="Status" src="https://img.shields.io/badge/status-alpha%20%C2%B7%20v0.2.2-d99a2b?style=flat-square">
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows-1f2328?style=flat-square&logo=apple&logoColor=white">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-1f2328?style=flat-square"></a>
</p>

<p>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-1f2328?style=flat-square&logo=electron&logoColor=9FEAF9">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-1f2328?style=flat-square&logo=typescript&logoColor=3178C6">
  <img alt="React" src="https://img.shields.io/badge/React-1f2328?style=flat-square&logo=react&logoColor=61DAFB">
  <img alt="Bun" src="https://img.shields.io/badge/Bun%201.4-1f2328?style=flat-square&logo=bun&logoColor=FBF0DF">
  <img alt="Swift" src="https://img.shields.io/badge/Swift-1f2328?style=flat-square&logo=swift&logoColor=F05138">
  <img alt="Convex" src="https://img.shields.io/badge/Convex-1f2328?style=flat-square&logo=convex&logoColor=EE342F">
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Workers-1f2328?style=flat-square&logo=cloudflare&logoColor=F38020">
</p>

<p>
  <a href="#getting-started">Getting started</a> &nbsp;·&nbsp;
  <a href="#devapps">DevApps</a> &nbsp;·&nbsp;
  <a href="#layout">Layout</a> &nbsp;·&nbsp;
  <a href="#development">Development</a> &nbsp;·&nbsp;
  <a href="ARCHITECTURE.md">Architecture</a> &nbsp;·&nbsp;
  <a href="docs/devapp-authoring.md">DevApp guide</a>
</p>

</div>

> [!WARNING]
> **Alpha.** Interfaces, on-disk formats, and the DevApp contract are still changing
> between releases. Expect breaking changes.

---

## What it is

Cozea is a desktop workspace for working on software with AI assistants. Beyond the
editor and assistant surfaces, it hosts **DevApps** — small applications that run inside
the workspace, are published to an organization catalog, and are installed by other
members of that organization.

### DevApps

DevApps come in two tiers, and the distinction is deliberate:

| Tier | Runs with | Boundary |
|---|---|---|
| **Development** | Your own privileges, on your own machine | None — this is the powerful tier, and it stays that way |
| **Published** | An app-owned container | Read-only root filesystem and an explicit capability grant; it cannot reach anything it was not granted |

[`docs/devapp-authoring.md`](docs/devapp-authoring.md) is the entry point for writing a
DevApp, and [`docs/devapp-runtime-contract.md`](docs/devapp-runtime-contract.md)
specifies the runtime boundary that published DevApps execute within.

## Requirements

| | |
|---|---|
| **Bun** | `1.4.0` (pinned via `packageManager`) |
| **Node** | 22 |
| **Platform** | macOS or Windows to run; **macOS 26+** for contained DevApps |

Windows builds are produced (NSIS), but the contained DevApp runtime is built on Apple's
Containerization framework and declares `.macOS(.v26)`. Elsewhere those surfaces are
unavailable rather than degraded — development DevApps still work.

## Getting started

```bash
git clone https://github.com/Cozea/electron-app.git
cd electron-app
git submodule update --init vendor/t3code
bun install
bun run dev
```

> [!IMPORTANT]
> The vendored submodule must be initialised **non-recursively**. `vendor/t3code` has
> nested submodules of its own that it does not declare, so
> `git clone --recurse-submodules` fails.

`bun run dev` prepares the vendored runtime and the native helpers before starting the
app. The first run builds the vendored server bundle and takes considerably longer than
subsequent ones; after that a stamp file lets it skip the rebuild while the pin is
unchanged.

Copy `.env.example` to `.env` and fill in your own backend endpoints. The repository does
not ship credentials, and no deployment is named in tracked files.

<details>
<summary><strong>Enabling contained DevApps</strong> (macOS, Apple silicon)</summary>

<br>

`bun run dev` compiles the container helper but not the kernel and manifest that sit
beside it, so contained DevApps report themselves unavailable until those are prepared
once:

```bash
bun run prepare:devapp-runtime
```

That downloads the digest-pinned kernel, ad-hoc signs the helper with the virtualization
entitlement, and writes `build/devapp-container-runtime/resource-manifest.json` — which
the app checks the helper and kernel against by sha256 before spawning either. It needs
Apple silicon and network access but no signing identity, and
`bun run prepare:devapp-runtime:check` verifies the result. Nothing else in the app
depends on it.

</details>

<details>
<summary><strong>Installing a macOS release</strong> (and why it warns you)</summary>

<br>

Cozea is free and is not distributed through the Apple Developer Program, so releases are
**not notarized**. macOS quarantines anything downloaded from the internet and refuses to
open an unnotarized app on the first attempt, reporting that the developer cannot be
verified. That warning is about the absence of an Apple subscription, not about the build.

To open it the first time, right-click the app in Finder and choose **Open**, then
confirm. macOS remembers the decision. If you would rather clear the quarantine flag
directly:

```bash
xattr -d com.apple.quarantine /Applications/Cozea.app
```

An unsigned build also cannot update itself. macOS validates a signature before applying
an update, so the in-app updater will fail to install what it downloads; new versions have
to be fetched from the releases page by hand.

Building from source, as above, avoids both problems — locally produced apps are never
quarantined.

</details>

## Layout

| Path | Contents |
|---|---|
| [`apps/desktop`](apps/desktop) | The Electron application — main process, preload, renderer |
| [`packages`](packages) | Publishable workspace packages, including the DevApp SDK |
| [`shared`](shared) | Types and logic shared across the main/renderer boundary |
| [`convex`](convex) | Backend schema and functions |
| [`cloudflare`](cloudflare) | Worker for collaboration transport and DevApp build orchestration |
| [`native`](native) | Swift helpers: container runtime, automation, preview |
| `vendor/t3code` | Vendored editor substrate (submodule; see [`docs/substrate-t3-pin.md`](docs/substrate-t3-pin.md)) |
| [`docs`](docs) | Architecture notes, plans, and the DevApp authoring guide |

[`ARCHITECTURE.md`](ARCHITECTURE.md) describes the repository roots, the renderer
dependency direction, and the boundary rules between them.

## Development

```bash
bun run typecheck     # renderer
bun run lint
bun run test
bun run dist          # package a local build
```

### The vendored substrate

`vendor/t3code` is pinned, and the pin is recorded in **two** places that must move
together: the parent gitlink and the SHA in
[`docs/substrate-t3-pin.md`](docs/substrate-t3-pin.md).

> [!CAUTION]
> The sync script treats the document as the source of truth, so bumping only the gitlink
> will be silently reverted on the next sync. Run `bun run prepare:t3-runtime` after any
> bump, and never pin to a commit that has not been pushed.

## License

Copyright (C) 2025-2026 Ramuse LLC.

Licensed under the **GNU Affero General Public License v3.0 or later**. See
[LICENSE](LICENSE) for the full text.

The AGPL's network clause applies: if you run a modified version of this software and make
it available to users over a network, you must offer those users the corresponding source
of your modified version.

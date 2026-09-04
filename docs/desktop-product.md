# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Audience and Jobs

Cozea serves software builders and teams working from a desktop development environment. They open local projects, work with multiple coding-agent providers, inspect and approve proposed changes, run terminals and previews, and collaborate without moving the project source into a hosted editor.

## Purpose

Cozea brings local software work, provider-neutral agent assistance, collaborative editing, previews, and organization-distributed DevApps into one persistent workbench.

## Positioning

Cozea is a provider-neutral control plane around the user's real local tools and workspaces. It coordinates Codex, Claude, Cursor, and OpenCode while keeping provider-native configuration and local project folders authoritative.

## Operating Context

Cozea is an Electron desktop application with a React workbench. A user works from a left navigation shell into projects, settings, DevApps, and agent capabilities. Agent sessions run through locally available provider runtimes; project files, terminals, and previews remain on the device. Organizations group initialized devices and can distribute immutable DevApps.

## Capabilities and Constraints

- The supported coding-agent providers are Codex, Claude, Cursor, and OpenCode.
- Users approve proposed file changes before Cozea writes them.
- Local project paths and provider configuration remain device authority; cloud records must not become authority for absolute local paths.
- Agent Skills has a zero-hosting-cost testing phase: personal management is device-local, provider-native configuration remains execution authority, and portable setup packs stand in for live organization synchronization.
- Agent Skills users manage only their own skills. Organization member setups are read-only sources for discovery and copying.
- The future organization catalog and synchronization transport are deliberately undecided; the local manifest and revision model must remain reusable when that transport is added.

## Brand Commitments

The product name is Cozea. New authenticated product surfaces preserve the incumbent workbench shell, semantic theme system, restrained motion, familiar desktop controls, and Light, Dark, Navy, Wine, Clay, Forest, and System themes.

## Evidence on Hand

- Application architecture and product invariants: `AGENTS.md`
- Desktop renderer and navigation: `apps/desktop/src`
- Electron-local runtimes and workspace catalog: `apps/desktop/electron`
- Provider contracts and inventory: `packages/contracts/src/t3`
- Current provider implementations: `apps/desktop/electron/substrate/providers` and `vendor/t3code/apps/server/src/provider`

No verified public usage, revenue, retention, or customer evidence is supplied by this repository and future product surfaces must not invent it.

## Product Principles

- Keep local work and provider-native state authoritative.
- Make consequential agent actions explicit, inspectable, and reversible.
- Present different providers through one coherent model without erasing their real compatibility differences.
- Let users move between Cozea and their standalone tools without configuration drift.
- Build the local testing path so it can adopt authenticated synchronization without replacing the user experience or portable data format.

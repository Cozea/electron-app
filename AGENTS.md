# AGENTS.md

This file provides instructions for AI coding agents working on this project.

## Project Overview

This is an Electron desktop application with a React frontend and Convex backend. It provides a collaborative AI-assisted development environment — a multi-pane workbench (file editor, AI chat, terminal, browser preview) with real-time collaborative editing powered by Yjs.

**Tech Stack:**

- **Frontend**: React 19, TypeScript, Vite, TailwindCSS v4, shadcn/ui, Radix UI
- **Routing**: TanStack Router
- **Desktop**: Electron 40 + electron-vite
- **Backend**: Convex (real-time serverless database)
- **AI Runtime**: Vendored T3 server (`apps/server/` + `vendor/t3code`) spawned by shadow child; local Effect-TS substrate in `apps/desktop/electron/substrate/`
- **Auth**: device-bound ECDSA identity, Cloudflare token issuer, Convex custom JWT
- **Collab**: Yjs CRDTs with E2E encryption
- **Package manager**: Bun (always use `bun` instead of npm/yarn/pnpm)

> **Note**: Use web search to find current versions and documentation. Do not hardcode specific version numbers.

### Effect (effect-smol) pin — read before touching `effect` deps

`effect`, `@effect/platform-node`, `@effect/sql-sqlite-bun`, and `@effect/vitest` are pinned to
**experimental effect-smol snapshot builds** via immutable `pkg.pr.new` URLs (one commit hash shared
across all four). Consequences:

- The API differs from mainline Effect v3 and moves between snapshots. Known traps:
  `effect/Context` does not exist (use `effect/ServiceMap`); `Effect.fork` is `forkScoped`/`forkIn`;
  client `RpcClient.Protocol.run(f)` takes a single handler (server `run` takes `(clientId, message)`).
- Repins must update **all four URLs to the same commit hash** (including
  `packages/effect-acp/package.json`), then run the full suite — a repin is an API migration,
  not a version bump.
- `scripts/apply-effect-rpc-jsonrpc-id-patch.mjs` (postinstall) patches an upstream bug where
  JSON-RPC `id: 0` is dropped by a truthiness check. On every repin, check whether upstream fixed
  it (the script throws if its anchor is missing) and drop the patch when it has.
- 46 files still carry `// @ts-nocheck` headers for real effect-typing errors (provider adapters
  mostly). Do not add new ones; the rest of the runtime is typechecked.

### ACP schema pin (packages/effect-acp) — assessed 2026-06-11

`src/_generated/` is generated from ACP schema release **v0.11.3** (unstable variant) and is
committed; the `generate` script is currently **not runnable as-is** (its
`@effect/openapi-generator` devDependency is not installed) — this is deliberate:

- Regenerating with `@effect/openapi-generator@4.0.0-beta.79` is **lossy even at v0.11.3**
  (drops `SessionConfigOptionCategory`, collapses `SessionConfigOption` unions). The committed
  output came from an older/patched generator stack. Never commit a regen that doesn't
  byte-match unless you've diffed the semantic content.
- Upgrading to schema v0.12+/v0.13.x additionally hits a generator fidelity gap: the new
  upstream composition style (`allOf` refs inside `oneOf` variants + parent-level properties,
  e.g. `CreateElicitationRequest`, `SetSessionConfigOptionRequest`) is flattened into unions
  that lose `message`/`requestedSchema`/`sessionId` — wire-invalid schemas.
- Protocol deltas v0.11.3 → v0.13.6 that matter when migrating: `session/set_model` was
  REMOVED (only `session/set_mode` remains; our runtime never called set_model),
  `session/elicitation*` renamed to `elicitation/create` + `elicitation/complete` (types
  `CreateElicitationRequest/Response`, `CompleteElicitationNotification`), plus stabilized
  `session/resume`/`close`/`delete`/`logout`, `additionalDirectories`, session usage updates.
  The mechanical rename fallout is ~54 type errors confined to this package and test fixtures.
- Reference check (2026-06-11): t3code (upstream sibling, actively developed) also still pins
  v0.11.3 with the same generator architecture — nobody on this stack has cracked v0.13
  generation yet. They pin published `effect@4.0.0-beta.78` + a patch adding RpcClient
  RequestHooks instead of our pkg.pr.new commit; consider that pin style on the next repin.

## Commands

```shell
# Install dependencies
bun install

# Fresh checkout: install dependencies and prepare the pinned T3 runtime
bun run bootstrap

# Development (runs Electron + Vite)
bun run dev

# Deploy Convex to production (ALWAYS use this, NEVER use `convex dev`)
bunx convex deploy

# Run API server
cd server && bun run dev

# Type checking
bun run typecheck

# Linting
bun run lint

# Build for production
bun run build
```

## Desktop Releases

Tagged releases are built by GitHub Actions and published as GitHub Releases in the **distribution repo**.
Main-branch cloud releases can also be built by CircleCI and uploaded to Cloudflare R2 for Electron auto-updates.
The fast agent-facing summary lives here; the fuller operator guide is in `docs/release-process.md`.

### Source vs Distribution Repos

- Source code repo (this repo): `Cozea/electron-app`
- Distribution repo (release assets live here): `Cozea/cozea-prod`

### How Releases Are Triggered

- A release build/publish runs automatically **only** when a git tag matching `v*` is pushed (e.g. `v0.0.7`).
- Normal branch pushes do **not** publish a release.
- `workflow_dispatch` can rebuild an existing tag in dry-run mode or publish it when `publish=true`.
- Release lanes are limited to `stable`, `beta`, and `canary`.
- Tag format:
  - Stable: `v0.2.1`
  - Beta: `v0.3.0-beta.1`
  - Canary: `v0.3.0-canary.1`
- Electron Builder's updater channel mapping is:
  - Stable -> `latest`
  - Beta -> `beta`
  - Canary -> `alpha`

Workflow file: `.github/workflows/release.yml`
CircleCI workflow file: `.circleci/config.yml`

### How To Cut a Release (Example)

```shell
# 1) Update package.json to the release version, then refresh the Bun lockfile
bun install

# 2) Commit
git add package.json bun.lock
git commit -m "chore: prepare v0.0.8 release"

# 3) Tag + push the tag (this is what triggers the release)
git tag v0.0.8
git push origin HEAD
git push origin v0.0.8
```

### What Gets Published

`electron-builder` is configured to publish to `cozea-prod` (see `electron-builder.config.cjs`). The release assets typically include:

- `Cozea-X.Y.Z-arm64.dmg` (primary macOS installer)
- `Cozea-X.Y.Z-arm64-mac.zip` (alternate download)
- `latest-mac.yml` and blockmaps (auto-updater metadata)

### Required CI Configuration

The release workflow expects these to be set in GitHub Actions for `Cozea/electron-app`:

- `GH_TOKEN`: must be able to create releases in `Cozea/cozea-prod`
- Apple notarization: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- macOS signing: `CSC_LINK`, `CSC_KEY_PASSWORD` (Developer ID Application certificate)
- Vite build-time env: `VITE_CONVEX_URL` (provided via Actions Variables or Secrets; see workflow `env`)
- Vite build-time env: `VITE_AI_API_URL` (provided via Actions Variables or Secrets; see workflow `env`)

CircleCI expects a context named `cozea-release` with:

- Vite build-time env: `VITE_CONVEX_URL`, `VITE_AI_API_URL`
- Cloudflare R2 upload: `COZEA_UPDATE_BASE_URL`, `COZEA_UPDATE_BUCKET`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`
- Apple notarization: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- macOS signing: `CSC_LINK`, `CSC_KEY_PASSWORD`
- Optional runtime metadata signing: `COZEA_RUNTIME_SIGNING_PRIVATE_KEY` or `COZEA_RUNTIME_SIGNING_PRIVATE_KEY_PATH`

### Local Release (Fallback)

If GitHub Actions is blocked/unavailable, you can publish a release from a macOS machine (arm64) as long as:

- You have a valid **Developer ID Application** signing identity installed in Keychain, and
- `VITE_CONVEX_URL` is available at build time (e.g. via `.env.local`), and
- You are authenticated with GitHub CLI (`gh auth login`).

Then run:

```shell
# Publishes to the distribution repo configured in electron-builder.config.cjs (cozea-prod)
GH_TOKEN="$(gh auth token)" bun run release
```

> **IMPORTANT - Convex Deployment**: This project uses **production Convex only**.
>
> - Always use `bunx convex deploy` to push schema/function changes
> - **NEVER** use `convex dev` or `bunx convex dev --once` - it switches the app to a dev deployment
> - Production URL: `https://your-deployment.convex.cloud`

### Documentation Layout

- Keep `AGENTS.md` at the repo root for the short, canonical agent instructions.
- Keep all other project markdown docs under `docs/`.
- When release behavior changes, update both `AGENTS.md` and `docs/release-process.md` in the same change.

## Project Structure

```
├── apps/
│   ├── desktop/                # Electron shell (@cozea/desktop)
│   │   ├── electron/           # Main process, IPC, substrate, workbench-runtime
│   │   └── src/                # React frontend (features, components, pages, router)
│   └── server/                 # @cozea/server substrate bootstrap
├── convex/                     # Convex backend functions
│   ├── schema.ts               # Database schema
│   └── lib/                    # Shared utilities
├── server/                     # Fastify API gateway
│   └── src/routes/             # AI model catalog, provider helpers, collab gateway
├── packages/                   # Internal packages (effect-acp, effect-sql, pty, contracts)
└── shared/                     # Shared types (collab protocol, assistant contracts)
```

## How Project Creation Works

Project creation is a simple form — there is no conversational wizard or AI involvement at this stage.

**Entry**: `/projects/new?mode=empty` or `mode=local`
**Component**: `apps/desktop/src/pages/NewProject.tsx` → `apps/desktop/src/features/projects/components/CreateProjectDialog.tsx`

### Fresh project (`mode=empty`)

1. User fills in: project name, local folder location, optional GitHub repo toggle
2. On submit:
   - IPC creates the folder on disk, runs `git init`, writes `.gitignore`
   - If GitHub repo requested: runs `gh repo create` via IPC
   - Convex `projects.create()` mutation creates the shared DB record (`syncStatus: "local_only"`)
   - `updateStatus()` mutation moves it to `"active"`
   - The device-local workspace catalog records the created folder as `managed`, including its concrete managed-root ID; no absolute path is written as cloud authority
3. Navigates to `/projects/p/{projectId}/workbench`

### Open existing folder (`mode=local`)

1. Electron preflights the selected directory and existing Git metadata.
2. If the canonical path already belongs to a local project, Cozea opens that project instead of creating a duplicate.
3. Otherwise Convex creates an idempotent `provisioning` project, then the workspace catalog attaches the exact selected path as `attached`.
4. Cozea never copies, renames, relocates, or assumes deletion ownership of an existing folder. Attached non-Git folders receive no source marker; attached Git folders may use the private `.git/cozea` marker.
5. Once attachment succeeds, the project becomes `active` and the workbench opens at the returned workspace ID.

Project deletion and **Clear all** may move only catalog-proven `managed` workspaces to Trash. Attached folders always remain on disk, including when they happen to live inside the configured managed-projects directory. Deleting a project stops its Dev Servers and sessions, clears project-scoped renderer/T3 state and local DevApp records, forgets its local workspace bindings, and schedules a bounded Convex cascade that removes project-owned rows and stored blobs before deleting the project document. Archiving does none of this cleanup and remains reversible.

## How the AI / Workbench Works

The AI chat runs **after** project creation, inside the workbench.

- The shadow child boots the vendored T3 server when `COZEA_T3_SERVER=1` (default on)
- The workbench chat tile (`WorkbenchAssistantChatTile`) connects via T3 RPC session (`useT3Cutover`)
- Four provider kinds are supported: `claudeAgent`, `codex`, `opencode`, `cursor`
- The chat surface (`CozeaChatSurface`) shows a message timeline, composer, and — when the AI proposes file changes — a diff approval panel
- Generated images are thread-scoped artifacts. Each assistant tile has persistent `Chat` / `Artifacts` views; hiding chat must not unmount its controller or stream. See `docs/assistant-artifacts.md`.
- Agent headers expose project/provider-scoped native Chat history. Drafts and image Blobs are device-local and independent of tiles; tile closure must not delete them. Preserve explicit missing-thread states and execution-context checks. See `docs/assistant-chat-history.md` for lifecycle, QA, and the optional `Dockerfile.agent-checks` container workflow.
- Users approve proposed changes before they are written to disk via `sync:writeFiles` IPC
- Browser, Dev Server, compatibility Project DevApp, and Org DevApp tiles use one renderer-wide T3 `<webview>` host. Never add `WebContentsView`, browser bounds IPC, screenshot substitution, native-surface occlusion, or a fallback browser host.
- Application overlays share the semantic body-portal/layer contract in `docs/workbench-overlay-architecture.md`. Browser-owned presentation belongs in `HostedBrowserWebview`; custom application overlays use `AppOverlayPortal` or its bounded anchored variant instead of raw global z-index values.

## How Device Identity Works

- One physical device is one Cozea user principal: the public `deviceId`, `userId`, and
  `identityKey` are the same `czd_…` value.
- Organizations are device groups with a public copyable `czg_…` ID. Admins add initialized
  devices by their public `czd_…` ID.
- Public IDs are identifiers, not credentials. Electron keeps separate ECDH encryption and ECDSA
  signing private keys in OS-backed secure storage; private keys are never copied or exposed.
- The Cloudflare worker verifies a device-signed challenge and issues short-lived,
  audience-bound ES256 tokens. Convex authorization must derive the caller from `ctx.auth`.
- This is a clean beta cutover; do not add legacy UUID/email identity migration paths.

See `docs/device-identity.md` for the protocol and deployment requirements.

## How Project DevApps Work

- The active product is organization-scoped immutable static and service artifacts. The project
  overflow menu shows **Publish** / **Update**; it never publishes a dev command or source folder.
- First publish requires a PNG, JPEG, or WebP logo. Cozea optimizes it locally; later updates retain
  the independently editable publication name and logo.
- Publication and consumption derive the device principal from verified Convex auth. Uploads use a
  short-lived reservation bound to that device, project, and organization; never accept a
  caller-selected user identity or an unreserved storage object.
- The Store lists organization releases, while Add Tile lists only active exact-version releases
  installed on this device. Install/update/uninstall is explicit; installed artifacts launch
  offline and never silently follow a publication's active release. Consumers receive bounded,
  immutable artifacts and never receive project source, local paths, workspace IDs, dev commands,
  or dependency-install recipes.
- Static releases use per-hash `cozea-devapp` origins. Published workers and Node services require
  a root version-2 `cozea-devapp.json`, committed `bun.lock`, deterministic build, and exact signed
  multi-platform OCI release. Their manifest selects the app-owned Apple Containerization device
  adapter or Cloudflare Sandbox hosted adapter plus exact state ownership. Missing containment has
  no utility-process or child-process fallback.
- Browser guests use the pinned T3 permission allowlist (clipboard read/sanitized write,
  notifications, and geolocation); all other permissions and unmanaged downloads are denied.
  Top-level external HTTPS opens outside restricted DevApp tiles. Device containers receive no host
  path without an explicit expiring release-bound folder grant; hosted containers can never mount
  local files. See `docs/devapp-contained-runtime.md`.
- Unpublished `cozea-devapp.json` workers run only in development preview after explicit expiring
  approval. Their utility process uses Node permissions as defense in depth but is not an OS
  sandbox and can reach the network. This intentional developer tier is separate from published
  contained execution; see `docs/devapp-worker-security-review.md`.
- Development workers declare concrete agent operations (`name`, `description`, bounded object
  `inputSchema`) through `worker.tools`. The authenticated MCP catalog can inspect declarations,
  and invokes them only against an exact installed living contained release after main rechecks the
  declaration, schema, workspace, unexpired approval, `agentInvocable`, concurrency, timeout, and
  result bounds.
- Approved development-preview guests alone expose `window.cozeaDevApp`, a versioned port to that
  package's worker. Privileged host operations stay on the worker's separate capability-gated
  channel; ordinary Browser and published DevApp guests never receive this preload API.
- Native DevApps are first-class projects. Use **Create native DevApp** or **Open existing DevApp**;
  the root `cozea-devapp.json` is validated during ordinary folder import. Local development
  packages appear only under Add Tile → Development, including from other projects on the same
  device; they never appear in the Store. `shared/devAppPackage.ts` is authoritative: run
  `bun run devapp:generate` after changing it and `bun run devapp:check` in verification.
- `@cozea/devapp-api` is the publishable, self-contained view/worker client. Keep its generated
  contract copies synchronized and verify its public boundary with
  `bun run --cwd packages/devapp-api build` plus `bun pm pack --dry-run` from that package.
- The historical machine-local `localProjectDevAppStore` and Dev Server source metadata remain only
  as compatibility support for already-persisted development tiles. Do not add new Store or publish
  callers to that catalog.

See `docs/project-devapps.md` for the full lifecycle and operational notes.

## How Agent Browser and Dev Server Preview Works

- `dev_server_status`, `dev_server_ensure`, and `dev_server_attach` use the built-in workbench **Dev Server** workflow for process management. Once a guest exists, page automation can target every live Browser, Dev Server, compatibility Project DevApp, and Org DevApp surface in the assistant's workbench.
- There is one managed Dev Server run per `(workspaceId, laneId)`. Its automatically detected frontend remains the default process; users may add device-local, workspace-scoped auxiliary commands from the tile for backends or workers. `dev_server_ensure` is idempotent: it reuses a ready run and joins a launch already in progress. Only an explicit user restart/stop replaces or stops the complete run.
- Normal `dev_server_ensure` calls omit `command`. Cozea builds a bounded candidate set from project evidence and ranks it with a tiny macOS Core ML helper, falling back deterministically; the model never generates shell text. A successful ready command is cached by evidence fingerprint. Agents may pass a command only when the user explicitly supplied or confirmed it, with a brokered `{port}` placeholder where needed. If an agent already started a server itself, it attaches and navigates to that port instead of ensuring another process.
- Static discovery includes root `index.html` plus `dist/`, `build/`, `out/`, and `public/` built outputs. When several safe candidates remain, the Dev Server tile shows a bounded command chooser and launches the selected candidate through the same authorized lifecycle.
- A process may have zero or more Dev Server surfaces. Closing its last surface leaves the process headless; the sidebar then shows `Dev Server — Running` so the user can reattach it.
- Reattachment binds the new tile to the singleton process's original PTY so accumulated logs and process ownership survive the tile-id change.
- Agent-created surfaces are inactive tabs in the requesting assistant's Dockview group. The user can select that tab or drag it into another grid cell without interrupting the server or the assistant.
- Preview control is leased per assistant thread. Direct user interaction interrupts the T3 control epoch; a competing agent gets another Dev Server surface attached to the same process rather than taking control or starting a duplicate process.
- Explicit opaque runtime tab IDs win. They are process-local, stay within T3's 128-character contract, and never expose serialized workbench identity. Without one, automation uses the thread's last controlled surface, then the active browser-backed tile in the same workbench. `preview_status` returns every eligible surface and its exact target ID; `open` and `dev_server_ensure` still default to the thread's Dev Server workflow.
- The Cozea host advertises the complete pinned T3 set: status, open, navigate, snapshot, click, type, press, scroll, evaluate, wait, recording start/stop, resize, color scheme, and the three Dev Server lifecycle operations.
- Development packages use `devapp_preview_ensure` and `devapp_preview_attach`. Ensure creates or reuses a project-confined preview but never grants requested capabilities; attach targets an existing approved preview. Once a living guest exists, ordinary preview operations can inspect and interact with it by exact runtime tab ID. `agentInvocable` governs worker exposure, not explicit user-directed control of the preview guest.

See `docs/dev-server-agent-automation.md` for the lifecycle, tool semantics, and QA matrix.

## How Agent Skills Work

- `/projects/skills` is a first-class local skill library for Codex, Claude, Cursor, and OpenCode.
- The testing release uses no hosted persistence: the editable canonical library lives under Electron `userData`, while provider-native skill folders remain execution authority.
- Cozea-managed provider copies carry binding metadata. Never overwrite an unmarked provider folder; external skills must remain read-only until explicitly copied or moved to recoverable local trash by the user.
- Portable `*.cozea-skills.json` setup packs provide the zero-cost read-only discovery/copy path. They must not include credentials, provider settings, or absolute local paths.
- Provider changes refresh Cozea's own runtime. Restart notices apply to standalone provider apps according to their reload behavior.

See `docs/agent-skills.md` for storage paths, safety boundaries, setup-pack behavior, and QA.

## How Collaborative Editing Works

- **Yjs CRDTs** keep files in sync across collaborators in real time
- Updates are **E2E encrypted** before leaving the device (per-project room keys)
- Encrypted updates are stored in Convex (`yjsUpdates` table) and snapshotted periodically
- A SQLite-backed **sync journal** in the main process queues file write ops with idempotency keys
- Per-file locks (`projectFileLocks`) and tombstones (`fileTombstones`) handle concurrent edit and delete-vs-edit conflicts

## Code Style

### TypeScript

- Use explicit types, avoid `any`
- Prefer interfaces over types for object shapes
- Use `type` for unions and utility types

```typescript
// ✅ Good
interface ProjectConfig {
  name: string
  stack: { backend: string; hosting: string }
}

// ❌ Bad
type ProjectConfig = any
```

### React Components

- Use function components with TypeScript
- Props interfaces named `{ComponentName}Props`
- Use `cn()` from `@/lib/utils` for conditional classes

```tsx
// ✅ Good
interface ButtonProps {
  variant?: "primary" | "secondary"
  children: React.ReactNode
}

export function Button({ variant = "primary", children }: ButtonProps) {
  return <button className={cn("btn", variant === "primary" && "btn-primary")}>{children}</button>
}
```

### Imports

- Use path aliases: `@/` for `src/`, `@shared/` for `shared/`
- Group imports: React, external libs, internal modules, types

## Convex Conventions

- Mutations use `v.` validators from `convex/values`
- Use `Id<"tableName">` for document references
- Internal functions prefixed with `internal.`

```typescript
// ✅ Good
export const create = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("projects", { ...args })
  },
})
```

## Git Workflow

- Commit messages: imperative mood, present tense
- Format: `<type>: <description>` (feat, fix, refactor, docs, chore)
- Keep commits focused and atomic

```shell
# ✅ Good
git commit -m "feat: add GitHub repo toggle to project creation dialog"

# ❌ Bad
git commit -m "Updated stuff"
```

## Boundaries

### ✅ Always

- Run `bun run typecheck` before committing
- Use existing UI components from `src/components/ui/`
- Follow the established patterns in similar files
- Use `bun` for all package management and script execution

### ⚠️ Ask First

- Adding new dependencies
- Modifying database schema (`convex/schema.ts`)
- Changes to authentication flow
- Modifying Electron main process
- Changes to the vendored T3 server bootstrap (`apps/server/src/t3Bootstrap.ts`)

### 🚫 Never

- Commit API keys, secrets, or `.env` files
- Modify `node_modules/` or generated files (`convex/_generated/`)
- Remove existing tests without explicit approval
- Push directly to main branch
- Use `convex dev` — always use `bunx convex deploy`

## Accuracy, recency, and sourcing (REQUIRED)

When a request depends on recency (e.g., "latest", "current", "today", "as of now"):

1. **Establish the current date/time** and state it explicitly in ISO format.
   - Preferred: `date -Is` (timestamp).

2. **Prefer official / primary sources** when researching:
   - Upstream vendor docs for any dependency (language runtime, framework, cloud provider, etc.)

3. **Prefer the most recent authoritative information**:
   - Use the newest versioned docs, release notes, or changelogs.
   - Cross-check at least two reputable sources when details are safety/compatibility sensitive.

### Context7 MCP

- Use Context7 when you need library/API docs.
- If known, pin the library with slash syntax (e.g., `use library /supabase/supabase`).
- Mention the target version.
- Fetch minimal targeted docs; summarize (no large dumps).

### Web search policy

- Enable and use web search only when it materially improves correctness (e.g., up-to-date APIs, recent advisories, release notes).
- Prefer official docs and primary sources; otherwise use Context7 MCP or reputable, widely-cited references.
- Record source dates (publish/release dates) when relevant.

## Default autonomy and safety

- Default to read-only exploration and analysis.
- When edits are needed, prefer **workspace-scoped** write access and keep changes inside the repo.
- When interacting with remote APIs, you must use READ-only calls, unless explicitily instructed otherwise by the user. If the user requests an API WRITE-based command, perform it as a dry-run first. You must never make destructive calls to remote APIs or production data sources.

### Editing files

- Make the smallest safe change that solves the issue.
- Preserve existing style and conventions.
- Prefer patch-style edits (small, reviewable diffs) over full-file rewrites.
- After making changes, run the project’s standard checks when feasible (format/lint, unit tests, build/typecheck).

### Reading project documents (PDFs, uploads, long text, CSVs, etc)

- Read the full document first.
- Draft the output.
- **Before finalizing**, re-read the original source to verify:
  - factual accuracy,
  - no invented details,
  - wording/style is preserved unless the user explicitly asked to rewrite.
- If paraphrasing is required, label it explicitly as a paraphrase.

### Container-first policy (REQUIRED)

- Codex must **never** install system packages on the host unless explicitly instructed.
- Prefer container images to supply all tooling used by the project.
- For code projects and dependencies: **use containers by default**.
- If the repo has an existing container workflow (Dockerfile/compose/Makefile targets), follow it.
- If the repo has no container workflow, create a minimal one.
- Keep repo-specific container details in the repo’s `AGENTS.md`.

### Secrets and sensitive data

- Never print secrets (tokens, private keys, credentials) to terminal output.
- Do not request users paste secrets.
- Avoid commands that might expose secrets (e.g., dumping env vars broadly, `cat ~/.ssh/*`).
- Prefer existing authenticated CLIs; redact sensitive strings in any displayed output.

## Baseline workflow

- Start every task by determining:
  1. Goal + acceptance criteria.
  2. Constraints (time, safety, scope).
  3. What must be inspected (files, commands, tests, docs).
  4. Whether the request depends on **recency** (if yes, apply the "Accuracy, recency, and sourcing" rules).
  5. If requirements are ambiguous, ask targeted clarifying questions before making irreversible changes.

## CONTINUITY.md (REQUIRED)

Maintain a single continuity file for the current workspace: `.agent/CONTINUITY.md`.

- `.agent/CONTINUITY.md` is a living document and canonical briefing designed to survive compaction; do not rely on earlier chat/tool output unless it's reflected there.

- At the start of each assistant turn: read `.agent/CONTINUITY.md` before acting.

### File Format

Update `.agent/CONTINUITY.md` only when there is a meaningful delta in:

- `[PLANS]`: "Plans Log" is a guide for the next contributor as much as checklists for you.
- `[DECISIONS]`: "Decisions Log" is used to record all decisions made.
- `[PROGRESS]`: "Progress Log" is used to record course changes mid-implementation, documenting why and reflecting upon the implications.
- `[DISCOVERIES]`: "Discoveries Log" is for when when you discover optimizer behavior, performance tradeoffs, unexpected bugs, or inverse/unapply semantics that shaped your approach, capture those observations with short evidence snippets (test output is ideal.
- `[OUTCOMES]`: "Outcomes Log" is used at completion of a major task or the full plan, summarizing what was achieved, what remains, and lessons learned.

### Anti-drift / anti-bloat rules

- Facts only, no transcripts, no raw logs.
- Every entry must include:
  - a date in ISO timestamp (e.g., `2026-01-13T09:42Z`)
  - a provenance tag: `[USER]`, `[CODE]`, `[TOOL]`, `[ASSUMPTION]`
  - If unknown, write `UNCONFIRMED` (never guess). If something changes, supersede it explicitly (don't silently rewrite history).
- Keep the file bounded, short and high-signal (anti-bloat).
- If sections begin to become bloated, compress older items into milestone (`[MILESTONE]`) bullets.

## Definition of done

A task is done when:

- the requested change is implemented or the question is answered,
  - verification is provided:
  - build attempted (when source code changed),
  - linting run (when source code changed),
  - errors/warnings addressed (or explicitly listed and agreed as out-of-scope),
  - plus tests/typecheck as applicable,
- documentation is updated exhaustively for impacted areas,
- impact is explained (what changed, where, why),
- follow-ups are listed if anything was intentionally left out.
- `.agent/CONTINUITY.md` is updated if the change materially affects goal/state/decisions.

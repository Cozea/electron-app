# AGENTS.md

This file provides instructions for AI coding agents working on this project.

## Project Overview

This is an Electron desktop application with a React frontend and Convex backend. It provides a collaborative AI-assisted development environment — a multi-pane workbench (file editor, AI chat, terminal, browser preview) with real-time collaborative editing powered by Yjs.

**Tech Stack:**
- **Frontend**: React 19, TypeScript, Vite, TailwindCSS v4, shadcn/ui, Radix UI
- **Routing**: TanStack Router
- **Desktop**: Electron 40 + electron-vite
- **Backend**: Convex (real-time serverless database)
- **AI Runtime**: Local WebSocket server (`electron/assistant-runtime/`) built with Effect-TS; providers: Claude Agent SDK, OpenAI Codex, opencode, Cursor
- **Auth**: WorkOS (SSO, organizations)
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

## Commands

```shell
# Install dependencies
bun install

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
> - Always use `bunx convex deploy` to push schema/function changes
> - **NEVER** use `convex dev` or `bunx convex dev --once` - it switches the app to a dev deployment
> - Production URL: `https://knowing-finch-546.convex.cloud`

### Documentation Layout

- Keep `AGENTS.md` at the repo root for the short, canonical agent instructions.
- Keep all other project markdown docs under `docs/`.
- When release behavior changes, update both `AGENTS.md` and `docs/release-process.md` in the same change.

## Project Structure

```
├── src/                        # React frontend
│   ├── features/
│   │   ├── projects/           # Core project feature
│   │   │   ├── components/     # Project UI (creation dialog, workbench tiles, assistant chat)
│   │   │   ├── pages/          # Workbench, Tasks, Team, Conflicts pages
│   │   │   ├── contexts/       # Sync + Yjs context providers
│   │   │   ├── hooks/          # Session lifecycle, git state, project access
│   │   │   └── workspaces/     # Workspace runtime store and hosting
│   │   └── devapps/            # Dev app registry and launchers
│   ├── components/
│   │   └── ui/                 # shadcn components
│   ├── pages/                  # Top-level pages (Login, NewProject)
│   ├── stores/                 # Zustand stores
│   └── router/                 # TanStack Router route definitions
├── electron/                   # Electron main process
│   ├── assistant-runtime/      # Local WebSocket AI runtime (Effect-TS)
│   │   ├── orchestration/      # Turn orchestration, session state
│   │   ├── provider/           # Provider integrations (Claude, Codex, opencode, Cursor)
│   │   ├── terminal/           # Terminal management
│   │   └── git/                # Git operations for the runtime
│   ├── ipc/                    # IPC handler registration (sync, project, session, runtime)
│   ├── workbench-runtime/      # Terminal + dev server child process
│   ├── runtime/                # Runtime manifest, installer, resolver
│   └── services/               # Electron services (sync journal, encryption, etc.)
├── convex/                     # Convex backend functions
│   ├── schema.ts               # Database schema
│   └── lib/                    # Shared utilities
├── server/                     # Fastify API gateway
│   └── src/routes/             # AI model catalog, provider helpers, collab gateway
├── packages/                   # Internal packages (effect-acp, effect-sql, pty)
└── shared/                     # Shared types (collab protocol, assistant contracts)
```

## How Project Creation Works

Project creation is a simple form — there is no conversational wizard or AI involvement at this stage.

**Entry**: `/projects/new?mode=empty` or `mode=local`
**Component**: `src/pages/NewProject.tsx` → `src/features/projects/components/CreateProjectDialog.tsx`

### Fresh project (`mode=empty`)
1. User fills in: project name, local folder location, optional GitHub repo toggle
2. On submit:
   - IPC creates the folder on disk, runs `git init`, writes `.gitignore`
   - If GitHub repo requested: runs `gh repo create` via IPC
   - Convex `projects.create()` mutation creates the DB record (`status: "draft"`, `syncStatus: "local_only"`)
   - `updateStatus()` mutation moves it to `"active"`
   - Local path written to `project-path-registry.json` (app data dir) and to `projectMembers.localPath` in Convex
3. Navigates to `/projects/p/{projectId}/workbench`

### Import existing folder (`mode=local`)
Same flow but skips folder creation. Inspects existing git state (remote URL, branch, provider) and stores it in `sourceControl` / `repoSource` on the project record with `creationPath: "repo"`.

## How the AI / Workbench Works

The AI chat runs **after** project creation, inside the workbench.

- A local WebSocket server starts at `ws://127.0.0.1:3773` via `electron/assistant-runtime/boot.ts` (Effect-TS)
- The workbench chat tile (`WorkbenchAssistantChatTile`) connects to this runtime
- Four provider kinds are supported: `claudeAgent`, `codex`, `opencode`, `cursor`
- The chat surface (`CozeaChatSurface`) shows a message timeline, composer, and — when the AI proposes file changes — a diff approval panel
- Users approve proposed changes before they are written to disk via `sync:writeFiles` IPC

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
  variant?: 'primary' | 'secondary'
  children: React.ReactNode
}

export function Button({ variant = 'primary', children }: ButtonProps) {
  return (
    <button className={cn('btn', variant === 'primary' && 'btn-primary')}>
      {children}
    </button>
  )
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
- Changes to the assistant runtime (`electron/assistant-runtime/`)

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
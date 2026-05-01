# AGENTS.md

This file provides instructions for AI coding agents working on this project.

## Project Overview

This is an Electron desktop application with a React frontend and Convex backend. It features AI-powered project creation through a conversational wizard that generates structured project plans.

**Tech Stack:**
- **Frontend**: React, TypeScript, Vite, TailwindCSS, shadcn/ui
- **Desktop**: Electron
- **Backend**: Convex (real-time database), Fastify (API gateway)
- **Auth**: WorkOS (SSO, organizations)
- **AI**: AI SDK (Vercel), multi-provider (Anthropic, OpenAI, Google)

> **Note**: Use web search to find current versions and documentation. Do not hardcode specific version numbers.

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
- `Cozea-X.Y.Z.dmg` or `Cozea-X.Y.Z-x64.dmg` (Intel macOS installer, depending on Electron Builder artifact naming)
- `Cozea-X.Y.Z-arm64-mac.zip` (alternate download)
- `Cozea-X.Y.Z-mac.zip` or `Cozea-X.Y.Z-x64-mac.zip` (Intel alternate download, depending on Electron Builder artifact naming)
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
├── src/                    # React frontend
│   ├── components/         # UI components
│   │   ├── wizard/         # Project creation wizard
│   │   ├── assistant/      # AI chat components
│   │   ├── ai-elements/    # Reusable AI UI primitives
│   │   └── ui/             # shadcn components
│   ├── pages/              # Route pages
│   ├── contexts/           # React contexts
│   ├── hooks/              # Custom hooks
│   └── agents/             # Agent runtime utilities
├── electron/               # Electron main process
├── convex/                 # Convex backend functions
│   ├── schema.ts           # Database schema
│   └── lib/                # Shared utilities
├── server/                 # Fastify API gateway
│   └── src/routes/ai.ts    # AI chat endpoints
└── shared/                 # Shared types
```

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
git commit -m "feat: add plan generation to wizard conversation"

# ❌ Bad
git commit -m "Updated stuff"
```

## Boundaries

### ✅ Always
- Run `bun run typecheck` before committing
- Use existing UI components from `src/components/ui/`
- Follow the established patterns in similar files

### ⚠️ Ask First
- Adding new dependencies
- Modifying database schema (`convex/schema.ts`)
- Changes to authentication flow
- Modifying Electron main process

### 🚫 Never
- Commit API keys, secrets, or `.env` files
- Modify `node_modules/` or generated files (`convex/_generated/`)
- Remove existing tests without explicit approval
- Push directly to main branch

---

## Agent-Specific Instructions

### Project Wizard Agent (`feature: project-wizard`)

The wizard conversation agent helps users create new projects through natural conversation.

#### Core Responsibilities

1. **Understand the user's project idea** by asking 2-3 clarifying questions
2. **Use web search** to research current best practices, frameworks, and technologies
3. **Generate 3 plan tiers** (Prototype, Beta, MVP) with increasing scope
4. **Output structured plan data** via the `data-plan-options` message part type

#### Web Search Requirements

The wizard agent MUST use web search to:
- Research current best practices and popular frameworks for the project type
- Find up-to-date documentation and recommended approaches
- Validate technology recommendations before suggesting them
- Discover modern tools and libraries relevant to the user's needs

**Do NOT hardcode specific version numbers** - always use web search to find current versions.

#### Plan Generation Format

When ready to present plans, emit a `data-plan-options` part with this structure:

```typescript
interface PlanOption {
  tier: 'prototype' | 'beta' | 'mvp'
  name: string                    // Project name
  description: string             // 1-2 sentence summary
  features: string[]              // 3-6 key features included
  estimatedScope?: string         // e.g., "~2 days", "~1 week"
  config: {
    name?: string
    description?: string
    audience?: string
    template?: string             // saas-dashboard, landing-page, blank
    stack?: {
      backend: string             // supabase, convex, firebase
      hosting: string             // vercel, netlify
      aiProvider: string          // anthropic, openai, google
    }
    sourceControl?: {
      provider: string            // github, gitlab
      visibility: string          // private, public
      mergeStrategy: string       // squash, merge
    }
    visuals?: {
      uiLibrary: string           // shadcn, chakra, mui
      primaryColor: string        // hex color
      secondaryColor: string
      accentColor: string
    }
    generatedPlan?: {
      pages: Array<{
        id: string
        name: string
        route: string
        type: string
        purpose?: string
      }>
      entities: Array<{
        id: string
        name: string
        fields?: string[]
      }>
    }
  }
}
```

#### Conversation Guidelines

- **Be conversational** but efficient - ask 2-3 clarifying questions max
- **Use web search** before making technology recommendations
- **Infer reasonable defaults** based on the project type
- **Always generate all 3 tiers** when presenting plans
- **Prototype**: Minimal viable features, fastest to build
- **Beta**: Core functionality complete, some polish
- **MVP**: Production-ready, all requested features

#### Technology Selection Process

1. Ask user about their preferences and constraints
2. **Search the web** for current best practices for their project type
3. **Research popular frameworks** and their current status (actively maintained, community size)
4. Present recommendations based on research, not outdated assumptions

#### Example Flow

```
User: "I want to build a task management app for small teams"

Agent: "A task management app - great choice! A few quick questions:
1. Should team members have different roles (admin vs member)?
2. Do you need real-time collaboration (seeing others' updates live)?
3. Any integrations in mind (Slack, calendar, etc.)?"

User: "Yes to roles, real-time would be nice, and Slack integration"

Agent: [Generates 3 plan options as data-plan-options part]
```

---

### Project Builder Agent (`feature: project-builder`)

The builder agent executes approved project plans by generating code and files.

#### Core Responsibilities

1. **Execute the approved plan** step by step
2. **Use web search** to find current documentation and implementation patterns
3. **Generate clean, maintainable code** following modern best practices
4. **Report progress** as tasks are completed

#### Web Search Requirements

The builder agent MUST use web search to:
- Find current API documentation for libraries being used
- Research implementation patterns and examples
- Verify compatibility between dependencies
- Find solutions for common issues and edge cases

#### Guidelines

- Always search for current documentation before implementing
- Follow the technology choices from the approved plan
- Generate code with proper error handling and types
- Use established patterns from the existing codebase
- ALWAYS use `bun` instead of `npm`, `yarn`, or `pnpm` for project generation and package management (e.g. `bun create vite`, `bun install`, `bun add`).

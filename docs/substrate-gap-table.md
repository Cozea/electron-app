# Substrate gap table (Cozea vs T3)

Date: 2026-08-26  
Pin: see `docs/substrate-t3-pin.md`  
Related: `docs/agent-pipeline-restoration-audit.md`, `docs/t3code-upgrade-path.md`, `docs/t3code-implementation-plan.md`

Living table of **capabilities / contracts / reactors** Cozea must gain or rebase. Update as Wave 0–3 PRs land.

## Legend

| Status | Meaning |
| --- | --- |
| missing | Not present in Cozea |
| thin | Present but materially behind upstream |
| present | Good enough / Cozea-specific overlay |
| n/a | T3 concept not applicable (Cozea overlay owns it) |

## Process & transport

| Area | T3 reference | Cozea today | Status | Target phase |
| --- | --- | --- | --- | --- |
| Spawned Node server | `apps/desktop` `DesktopBackendPool` | In-process `electron/assistant-runtime` | missing | Phase 1 |
| Effect RPC `/ws` | `packages/contracts` + server rpc | Custom WS push bus + ~215 IPC | thin | Phase 2 |
| `client-runtime` supervisor | `packages/client-runtime` | `assistant-wsTransport` + Zustand projectors | thin | Phase 2 |
| Per-method RPC auth | contracts auth scopes | Desktop trust / ad-hoc | thin | Phase 2–5 |
| NDJSON / OTLP | `apps/server/src/observability` | Ad-hoc logs; partial provider NDJSON logger exists | thin | Track E / Phase 6 |
| BackgroundPolicy | `background/BackgroundPolicy.ts` | Polls often always-on | missing | Track D lite → Phase 6 |

## Providers

| Area | T3 reference | Cozea today | Status | Target phase |
| --- | --- | --- | --- | --- |
| Driver registry + managed snapshots | `ProviderDriver`, managed provider | Partial (`ProviderDriver` landing on main); still thinner contracts | thin | Phase 3 |
| Claude adapter depth | ClaudeAdapter + tests | Present, selective ports | thin | Phase 3 |
| Codex session runtime | large CodexSessionRuntime | Historically thin | thin | Phase 3 |
| Cursor / OpenCode | drivers | Relatively closest | thin | Phase 2–3 first cutover |
| Grok | optional | absent | missing | optional |

## Orchestration

| Area | T3 reference | Cozea today | Status | Target phase |
| --- | --- | --- | --- | --- |
| Event-sourced engine | OrchestrationEngine | Present (Effect) | thin | Phase 2–3 |
| ThreadDeletionReactor | `ThreadDeletionReactor` | Incomplete / missing orphan WT UX | thin | Track B / 4e |
| Checkpoint reactor → VcsDriver | checkpoints on driver | Dual: orchestration + `gitCheckpoints`/worker | thin | Phase 4a–4b |
| Drainable workers | test harness | Mixed | thin | ongoing |

## VCS / terminals

| Area | T3 reference | Cozea today | Status | Target phase |
| --- | --- | --- | --- | --- |
| VcsDriver | `apps/server/src/vcs` | Multi-owner git (GitCore + IPC + Changes + collab) | missing | Phase 4a |
| subscribeVcsStatus local/remote | VcsStatusBroadcaster | Monolithic / dual broadcasters | missing | Track F → 4c |
| terminal.attach RPC | server terminal | Electron TerminalService + runtime PTY | thin | Phase 4a |
| Push safety | refuse mismatched upstream | Unsafe patterns remain in places | thin | Phase 4e |
| Paginated listRefs | `vcs.listRefs` | Full dumps | missing | Phase 4a |

## Product overlays (keep)

| Area | Cozea | T3 | Status |
| --- | --- | --- | --- |
| Convex + E2E Yjs | present | n/a | present |
| WorkOS org auth | present | different | present |
| Workspace catalog | present | different | present |
| Project DevApps | present | n/a | present |
| Dockview workbench | present | n/a | present |
| Sync journal | present | n/a | present |
| Command palette UI | contracts yes / UI missing | present | thin — Track A |
| Browser agent automation | architecture docs | previewAutomation | thin — Track C |

## Contracts surface (high level)

Prefer wholesale adopt of T3 `packages/contracts` groups: `orchestration`, `provider`, `terminal`, `vcs`, `git`, `keybindings`, `background`, `preview` — then **add** Cozea-only contract modules for catalog / DevApps / collab journal rather than forking every T3 method.

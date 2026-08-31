# DevApp Rebuild Ledger

Where the nine-phase rebuild actually stands — what shipped, what shipped partially, and
what was left suspended with the reason it stopped.

|                         |                                                           |
| ----------------------- | --------------------------------------------------------- |
| Original parent commits | 15                                                        |
| Phase 5 follow-up       | 2 parent commits + 3 T3 fork commits                      |
| New modules             | 16                                                        |
| Test files              | 18                                                        |
| Full suite              | 199 files / 1538 tests passing (1 file / 4 tests skipped) |
| Phases complete         | 3 of 9                                                    |

Originally audited at `78cb74bd` on `main`; live Phase 5 acceptance was refreshed on
2026-09-01 from the current `main` line plus the dedicated acceptance and protocol branches.
All three typecheck projects, focused tests, lint, the full suite, and the production build pass. Phase scope is
quoted from the DevApp Rebuild Plan. Every "left suspended" item was checked in code
rather than recalled.

---

## The shape of it

The rebuild started from one bug: `/Users/admin/dev/nihao` could not be published.
Diagnosing it exposed that the restriction wasn't the bug — the model was. DevApps could
only be one of eight hardcoded kinds, could only be a web view, and could only be authored
by building blind and hoping.

What exists now is a different system underneath the same UI. A DevApp is described as
composable parts rather than picked from a closed list. It has a durable name that survives
storage and crosses projects. It can ask for capabilities from a settled vocabulary, run
privileged code out of process behind a gate that enforces them, and be developed locally
against the exact path it will take once published.

What does not exist yet is the half that makes it a _platform_ rather than a better
runtime: nobody outside the team can author against it, worker-declared agent tools do not
flow into ACP sessions, and installation is still a cache rather than an install. Agents can
now create or attach a development preview and drive its living guest after the user grants
the package's requested session capabilities.

> **The honest headline: 3 phases delivered, 3 partial, 3 untouched.**
> The three partials each have a specific, named gap that a later phase depends on — which
> is why they are counted as partials here rather than quietly rounded up.

---

## Phase ledger

### Phase 0 — Preflight and error taxonomy — **Delivered**

**Shipped.** A static validator that reports every problem in one pass before the build
runs, with machine-readable codes rather than dialog prose. Eleven diagnostic codes across
project shape and build output. Fixed the original nihao failure, plus the bare `ENOENT`
that dangling pnpm symlinks produced, and the swallowed stdout that hid the real build
error.

**Left suspended.** Output detection still uses the hardcoded five-directory probe at
`OrgDevAppArtifactService.ts:41`. The plan called for reusing the existing Core ML ranker
instead. Low cost, no dependents.

### Phase 1 — Parts decomposition — **Partial**

**Shipped.** View, worker, and service as independent parts. All eight shipping variants
round-trip through the model, which is what proved it could express the real system.
Surfaces — tile, agent tool, background service — are _derived_ from parts rather than
declared, so adding a surface later is one resolver rather than an edit to every manifest
already published.

**Left suspended.** Parts never reached the Convex `devAppReleases` schema — the model is
renderer-side only, and nothing dispatches on it. The launch spec is still the runtime
path. The fate of `localProjectDevAppStore`'s compatibility rows was never decided.

### Phase 2 — Registry and surface resolver — **Partial**

**Shipped.** Durable refs — `cozea-devapp:org_x/pub_y@7` — that survive storage, cross
project boundaries, and can be written by hand. Parsing fails closed, and `builtin` and
`dev` are reserved owners so a publication can impersonate neither a first-party app nor an
in-development one.

Built-ins are now self-contained manifest modules discovered through `import.meta.glob`, not
members of a second hardcoded array. Each manifest owns its composable parts, and surface
resolution dispatches on those parts. Duplicate IDs, assistant providers, and native surface
targets fail during registry construction instead of resolving by import order.

The workbench shell now has one typed descriptor for every persisted tile identity. Default
titles, tab labels and groups, renderer lifetime, constraints, float/popout geometry,
browser-backing, icon source, and header ownership all flow from that descriptor. Dockview,
layout restoration, tile chrome, sidebar summaries, and component registration consume it.
Renderer implementations remain a separate typed catalog, so an identity may reuse an existing
renderer without adding another shell switch; only a genuinely new UI needs a new component.

**Left suspended.** Publication resolution against Convex is deferred, and the cross-project
reference UX was never built, so durable refs still have no consumer. A new built-in using an
existing surface now adds one manifest module; a new persisted tile identity adds one shell
descriptor plus its actual data/component implementation when that UI does not already exist.

### Phase 3 — Capability vocabulary — **Delivered**

**Shipped.** Twelve capabilities, deliberately scoped — `project.read` is bounded to the
granting workspace and is a different capability from machine-wide `fs.read`. Three trust
tiers. Agent invocation modelled as its own axis rather than one more entry in the list,
because being driven with nobody watching multiplies the risk of whatever is held.
Stress-tested against Terminal and Dev Server, the two hardest consumers.

**Notable.** `shell.open` was split from `shell.reveal` after a question exposed that they
had been conflated. Opening a URL and revealing a path are different powers: the first is
restricted to web schemes, the second is bounded to the workspace or the app's own data
directory.

### Phase 4 — Worker host and protocol — **Partial**

**Shipped.** An out-of-process host with crash capture, bounded restarts, a log ring
buffer, and lease-based lifetime — one mechanism serving tile, agent, and background
surfaces alike. Authorization happens at the host, never in the view, and a denial is an
ordinary response rather than a kill, so an over-broad manifest is a fixable mistake instead
of an outage. Workers are bound to one workspace at start and handlers ignore any workspace
a request names.

**Left suspended.** The plan called for `MessageChannelMain` ports bridged to _views_
through preload. That does not exist — `preload.ts` has zero worker references, so a worker
can talk to main but a view cannot talk to a worker. The previously overdue protocol
versioning policy is now implemented; the missing view bridge is the remaining Phase 4 gap.

### Phase 5 — Development mode and preview tile — **Delivered**

**Shipped.** The authoring loop, and the first phase that delivers user-visible capability.
A `cozea-devapp.json` manifest that fails closed. Provisional trust that is never persisted
and shares no namespace with published approvals. A preview session running the same
parser, host, gate, and preflight a published app runs. A debounced watcher, its own browser
session, its own protocol origin, and a tile. The tile is now reachable from the normal
workbench command palette, is routed through the browser-backed Dockview policies, and
reloads when generated output under `dist`, `build`, or `out` changes.

The `Cozea/t3code` fork now owns `devapp_preview_ensure` and
`devapp_preview_attach`; the generated parent contracts are synchronized from pinned fork
revision `5725b2eb`. Ensure creates or reuses a project-confined package tile without granting
capabilities. Attach binds an existing approved package to its exact runtime tab. Generic T3
snapshot and interaction operations then target the same living guest the user sees.

`agentInvocable` remains a package-worker declaration, not a preview-control switch. A package
with `agentInvocable: false` can still be inspected and interacted with when the user asks the
assistant to control its approved development preview; it simply does not expose its worker as
an autonomous agent surface.

### Phase 6 — Authoring contract and headless publish — **Not started**

`cozea-devapp.schema.json` generated from the internal source; `@cozea/devapp-api` typings
and the view-side port client; a scaffold command; programmatic publish that bypasses the
dialog flow; docs served publicly and as an MCP server inside Cozea.

**Its single internal source now exists** — `shared/devAppPackage.ts` was written in Phase 5
to be exactly that, so this phase starts from a settled format rather than inventing one.

### Phase 7 — Agent surface and installation semantics — **Not started**

Workers declaring MCP operations that flow into ACP session setup; resolving the five
installed-but-unreferenced MCP packages; turning the cache into a real install with
uninstall, version pinning, and offline launch; storage management UI and an
update-available state instead of silently following `activeReleaseId`.

### Phase 8 — Container runtime, then hosted location — **Not started**

A container runtime adapter, which turns the native-code ban from a blanket rule into a
runtime-scoped one; a central build path; hosted location as a manifest value; shared state
semantics and the trust model for code Cozea executes on someone's behalf.

---

## Suspended, in detail

### The agent automation contract — Phase 5, completed

`devapp_preview_ensure` / `devapp_preview_attach` now live in the `Cozea/t3code` fork, along
with their MCP tools, handlers, schemas, and contract tests. The parent repository pins that
fork revision and synchronizes its generated contract mirror, so a future contract sync
preserves the operations instead of deleting them.

The Cozea adapter owns only product-specific work: project-relative package confinement,
Dockview placement, capability-approval status, workbench targeting, and translation from the
development session into the shared T3 surface inventory. It never grants capabilities on the
assistant's behalf.

### The view-to-worker bridge — Phase 4, not built

A DevApp's view has no way to call its own worker. The host is complete and the gate works,
but nothing bridges a `MessageChannelMain` port through preload to the renderer. Until this
exists, a worker is reachable only by main — so the tile surface can show worker logs and
crashes but cannot invoke anything.

### Protocol versioning policy — cross-cutting, completed 2026-09-01

Manifest and worker protocol versions are independent. Each package targets one exact,
positive worker protocol version; the host never silently downgrades it. Version 1 is the
current and only supported contract. Pre-Phase-6 manifests and messages that omit the field
normalize to version 1 only, while new authoring clients must write it explicitly.

Main rejects unsupported package versions before spawning code, transfers the selected and
supported versions in the port bootstrap, requires the selected version on every normalized
request/response/event, and rejects explicit mismatches before authorization or dispatch.
Future versions require their own parser and method table. The complete immutable-version and
security policy is in `docs/devapp-worker-protocol.md`.

### Adversarial security review — cross-cutting, overdue

Also scheduled for before Phase 4. A worker holding `fs.write` and `terminal.spawn` is
arbitrary code execution and deserves review as such. The boundaries were designed carefully
and each has tests that fail when the guard is removed — but nobody adversarial has looked
at them, and self-review is not the same thing.

### Registry consolidation — Phase 2, completed 2026-09-01

`BUILTIN_DEV_APPS` is discovered from self-contained manifest modules, and the parallel
provider/surface maps are gone. Built-in manifests own their parts. One typed workbench registry
now supplies shell policy to Dockview, layout restoration, tile chrome, sidebar icons, and the
component catalog. Architecture tests fail if those consumers reintroduce the preview-specific
switches that originally made one surface touch five shell files.

### Parts on the release record — Phase 1, open

The parts model never reached Convex. It describes the system accurately and joins packages
to published apps, but no release carries its parts, so nothing can dispatch on them. The
back-compat resolver exists; the storage does not.

### Cross-project references — Phase 2, open

Refs can name an app published from another project. Nothing resolves that name yet — there
is no Convex-side lookup and no UI for picking such an app. The addressing primitive shipped
without its consumer.

### Build adapter test fixtures — cross-cutting, open

The build adapter's auto-detect path — where publishing actually fails in practice — still
has no fixtures for the real package managers. Preflight now catches much of what used to
reach the build, which reduces the exposure but does not close it.

### Core ML output detection — Phase 0, deferred

The hardcoded five-directory probe survives. The ranker that could replace it already exists
and is already used for dev-command candidates. Genuinely optional.

---

## Live verification status

Three formerly unverified paths now have direct Electron evidence. One broader lifecycle walk
remains.

**The utilityProcess adapter — verified 2026-09-01.** A real development package with a
worker started Electron's Node utility process after session-scoped capability approval.
Closing the tile and presenting an unsupported manifest both removed that process; restoring
the manifest recreated it.

**The preview tile — verified 2026-09-01.** The workbench command opened a real package, the
approval screen listed the exact requested capability, the living `cozea-devapp://` guest
accepted interaction, an unsupported manifest displayed its actionable preflight error,
the persisted tile restored after app restart, and a `dist/index.html` edit hot-reloaded in
place. This smoke found and fixed two real gaps: missing Dockview registration and generated
output being ignored by the watcher.

**Agent preview use — verified 2026-09-01.** A real Codex tile called
`devapp_preview_ensure`, received `needsApproval` without a guest or tab ID, and could not
bypass the session grant. After the user-scoped approval, `devapp_preview_attach` returned the
exact living tab, `preview_snapshot` read the rendered page, `preview_click` activated
“Verify interaction,” and a second snapshot read “Interaction verified in the living preview
guest.” This smoke found and fixed two packaging/runtime gaps: hidden guests cannot rely on
`webContents.capturePage()`, and Playwright's injected selector runtime must be embedded in the
desktop bundle rather than resolved from the packaged main output at runtime.

**The full loop, end to end.** Author a package, preview it, fix a preflight failure,
publish, install, open. Each segment is tested; the whole path has never been walked. That
walk is the real acceptance test for Phase 5 and it has not happened.

---

## Where the code is

### Contracts — `shared/`

| Module                      | Role                             |
| --------------------------- | -------------------------------- |
| `devAppCapabilities.ts`     | vocabulary, tiers, grants        |
| `devAppWorkerProtocol.ts`   | wire format, authorization table |
| `devAppPackage.ts`          | `cozea-devapp.json` parser       |
| `devAppDevelopmentTrust.ts` | provisional grants               |
| `devAppPreviewTypes.ts`     | status the tile renders          |
| `devAppPreviewProtocol.ts`  | the `.dev` origin                |
| `orgDevAppDiagnostics.ts`   | error taxonomy                   |
| `browserSurfaceSessions.ts` | partition isolation              |

The worker wire lifecycle and compatibility policy are documented in
`docs/devapp-worker-protocol.md`.

### Host — `apps/desktop/electron/services/`

| Module                     | Role                      |
| -------------------------- | ------------------------- |
| `DevAppWorkerHost.ts`      | supervisor and gate       |
| `devAppWorkerHandlers.ts`  | binding-enforced methods  |
| `devAppHostServices.ts`    | real fs, shell, workspace |
| `devAppUtilityProcess.ts`  | the Electron adapter      |
| `DevAppPreviewSession.ts`  | the authoring loop        |
| `DevAppPreviewService.ts`  | session + watcher + IPC   |
| `DevAppPreviewWatcher.ts`  | debounced reload          |
| `devAppPreviewAdapters.ts` | fs port, source ids       |
| `orgDevAppPreflight.ts`    | the validator             |

### Renderer — `apps/desktop/src/`

| Module                                                                  | Role                          |
| ----------------------------------------------------------------------- | ----------------------------- |
| `features/devapps/registry/parts.ts`                                    | parts and surfaces            |
| `features/devapps/registry/ref.ts`                                      | durable names                 |
| `features/projects/lib/workbenchTileRegistry.ts`                        | workbench shell contract      |
| `features/projects/components/workbench/WorkbenchDevAppPreviewTile.tsx` | the tile                      |
| `features/projects/devapps/devAppPreviewRuntimeStore.ts`                | live status for automation    |
| `features/projects/devapps/devAppPreviewSurfaceController.ts`           | package-to-Dockview placement |
| `electron/ipc/registerDevAppPreviewHandlers.ts`                         | IPC boundary                  |

---

## What comes next

In dependency order, not preference order.

1. **Walk the preview loop by hand — complete 2026-09-01.** A real view-plus-worker package
   now covers selection, approval, rendering, interaction, invalid-manifest recovery,
   restart restoration, built-output hot reload, and lease teardown. The broader
   author-preview-fix-publish-install-open walk remains under the full-loop item above.

2. **Agent development-preview automation — complete 2026-09-01.** The fork owns the two
   lifecycle operations and fixes required for hidden capture and packaged selector injection;
   the parent host creates, attaches, targets, and controls the approved living guest.

3. **Protocol versioning — complete 2026-09-01.** Exact version selection, v1-only legacy
   aliases, bootstrap metadata, message envelopes, host enforcement, restart behavior, and
   immutable-version policy now protect the Phase 6 authoring boundary.

4. **Registry/surface consolidation — complete 2026-09-01.** Built-ins are self-contained,
   parts drive surface resolution, and the workbench shell consumes one typed descriptor instead
   of parallel tile lists. Cross-project durable-reference resolution remains the independent
   Phase 2 gap.

5. **Get the capability model reviewed adversarially.** Before anyone outside the team can
   author a worker — which is Phase 6 — not after.

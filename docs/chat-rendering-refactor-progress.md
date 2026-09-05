# Conversation rendering refactor progress

## Baseline and evidence policy

Baseline: Cozea `935fac31`, pinned T3 `f2df43a98bc42936dd2a031d832c8c4dae53398a`.
Branch: `codex/conversation-rendering-parity`. Open PR inventory checked on
2026-09-05: no active conversation rendering refactor identified.
This matrix precedes implementation. Source-only findings are not executable
reproductions. Tests listed below are existing coverage or required acceptance
fixtures, not a claim that those fixtures have passed.

## Ownership

| Concern | Current owner | Required boundary |
| --- | --- | --- |
| Shell metadata | `packages/client-runtime/src/t3/t3OrchestrationClient.ts` shell materializer; `apps/desktop/src/features/assistant/model/t3ShellSnapshot.ts` | Sparse shell revisions own project/thread metadata, never detail-array authority. |
| Thread detail | `apps/desktop/src/features/assistant/model/threadDetailStore.ts` | One typed reducer, snapshot readiness and revision; authoritative empty arrays. |
| Turn lifecycle | Server session/latestTurn; currently detail `turnSettled` and shell state | Actual turn identity and terminal session state; item completion cannot settle turn. |
| Item lifecycle | Detail message events and activity payloads | Native message/tool identities and actual outcomes. |
| Connection recovery | `apps/desktop/src/substrate/useTileThreadStream.ts`, T3 client and Effect RPC | Explicit subscription supervisor, cancellation, fresh session credentials and snapshot/replay deduplication. |
| Presentation | `MessagesTimeline.logic.ts`, `MessagesTimeline.tsx`, `toolPhase.ts`, reveal controller | Pure turn projection; local disclosure/reveal/focus state; LegendList alone owns scroll. |

All unqualified assistant paths below are under
`apps/desktop/src/features/assistant/`. Pinned reference paths are under
`vendor/t3code/` and must stay at the recorded pin.

## Finding-by-finding baseline matrix

| Finding | Classification | Current source and evidence | Acceptance |
| --- | --- | --- | --- |
| Legacy message completion settles turn | Source-only risk | `model/orchestrationReadModelProjector.ts`; current T3 shell bypasses this path | Reconcile callers; same-turn running guard, stop/error/late chunks. |
| Detail plans/reverts omitted | Source-only risk | `model/threadDetailStore.ts` switch omits both; pinned `packages/client-runtime/src/state/threadReducer.ts:473` and `:536` handle both | Failing-before plan/revert live/snapshot fixtures required. |
| Empty detail loses authority | Source-only risk | `features/workbench/assistant/useWorkbenchAssistantTileController.tsx:489` uses array lengths | Loaded empty snapshot must clear each array without stale fallback. |
| Sparse shell metadata and global subscriptions | Already fixed | T3 shell materializer handles sparse upserts/removals; baseline integration | Preserve and test stale snapshot/removal/reconnect behavior. |
| Late buffered text reactivates stopped state | Already fixed, identity risk remains | Detail message branch preserves text using `turnSettled`; boolean is not turn-scoped | Late old-turn text during a new turn must not alter new lifecycle. |
| Disconnect/replay/credential renewal | Source-only risk | `useTileThreadStream.ts` connects once; persistent T3 subscriptions omit disconnect callback | Deterministic retry/cancel/replay/fresh credential fixtures. |
| Approval kinds/options/details/warnings | Already fixed | `chat/session-logic.ts`, approval actions/panel; integration baseline | End-to-end exact decisions, app identity and warnings; no invented scope. |
| Empty-option and metadata question parsing | Already fixed | `chat/session-logic.ts:306` retains allowCustomAnswer/multiSelect | Preserve native values and fixed-choice restrictions. |
| Question multi-select interaction | Source-only risk | `ComposerPendingUserInputPanel.tsx:125` compares one selectedOptionValue | Blocking/async multi-select, duplicate labels, free text, durable retry and scoped keyboard fixtures. |
| Compaction and controlled update continuation | Already fixed | Baseline integration; plan preservation requirement | Retain provider capability gates and server-owned continuation. |
| Restored attachment variants and URLs | Source-only risk | `model/threadDetailStore.ts` maps every variant to image and only copies previewUrl | File/image round-trip, authorized URL refresh, intelligible unsupported kind. |
| Inactive tool success summaries | Source-only risk | `chat/toolPhase.ts` mixes presentation activity with outcome | Running/completed/failed/declined/stopped truthful summaries. |
| Terminal footer, folds, trailing tools | Source-only risk | Custom timeline lacks pinned turn folds; pinned `MessagesTimeline.logic.ts:544` defines settled folds | Exact text and one terminal footer through commentary/tools/final and trailing/background activity. |
| Active response continuity and steering | Source-only risk | Custom projection versus pinned running-turn precedence | Promptless restart and steered user boundary fixtures, stable item ownership. |
| Reasoning/tools/text/waiting distinction | Source-only risk | Existing generation phase and toolPhase independently gate Thinking | Explicit provider reasoning only, tools→thinking→text and terminal clearing. |
| Task/subagent and runtime plan steps | Source-only risk | `deriveActivePlanState` exists; no dedicated task ownership surface established | Real native identities, background ownership, compact diagnostics; inspect pinned capabilities. |
| Workspace media and provider directives | Source-only risk | Custom Markdown lacks centralized workspace resolver; pinned runtime includes `codexMarkdownDirectives.ts` | Inspect supported directives/citations and media contract before implementation; preserve editor/artifact routing. |
| Canonical text update cost | Source-only risk | Timeline input rebuilds independently of renderer-only reveal | Profile long canonical updates and reveal frames; unrelated row identity retained. |
| Disclosure and scroll anchoring | Source-only risk | LegendList is current scroll owner | Safe Electron narrow/wide/long history, recycling, hidden/concurrent tiles and reduced-motion fixtures. |
| Non-emitted provider variants | Capability classification pending | Pin inspection underway; do not assume old audit's image-only contract | Explicit unsupported capability only with pinned contract evidence; never silently reclassify. |

## Verification record

- Clean clone and exact submodule checkout verified. No paid provider calls or real conversations touched.
- Docker CLI exists but daemon socket is unavailable. Existing macOS toolchain is used for this Electron checkout; container verification remains unavailable.
- Frozen Bun dependency installation started with lifecycle scripts disabled; no new dependency requested.
- Application implementation and acceptance executions remain pending. No finding is marked reproduced without a failing fixture, and no phase is accepted yet.

### Phase 1 failing-before evidence

`bun run test tests/substrate/threadDetailParity.test.ts`: **2 failed** on the
unchanged application reducer. Plan upsert expected `revised`, received `a`;
revert expected system/unbound/retained-turn messages, also received removed-turn
message `b`. This promotes plan/revert handling from source-only risk to
**reproduced and open**. Fixtures include sparse sequences and stale replay,
nonzero and zero reverts, plans, activities, checkpoints, and system/unbound
message retention, matching pinned reducer rules. They remain intentionally red
until the authoritative reducer adaptation is implemented.

Frozen dependency installation completed successfully without lockfile changes.

## Integrated implementation checkpoint — 2026-09-05T06:54Z

The baseline matrix above is historical, not the current completion claim.
The stopped standalone task's edits were retained. Parent-supervised actual
GPT-6 Astra low subagents implemented bounded phases in this checkout; independent
cross-review found and fixed terminal messages remaining marked streaming,
expanded trailing-work reordering, compaction folding and unstable snapshot tool
keys. No vendor sources, lockfiles, provider enablement or backend contracts changed.

| Area | Current evidence | Remaining acceptance |
| --- | --- | --- |
| Canonical detail | Pinned reducer adapter; explicit loaded/empty authority; sparse sequence/deletion handling; plan/revert parity; terminal/no-final-flush/snapshot and old-turn tests; controller no longer selects by array length. | Full per-provider equivalent renderer replay matrix and final review. |
| Connections | Shared/ref-counted native shell/detail supervisor; fresh abortable credentials; no replay of unary mutations; 12 focused transport tests; visible connection notice. | Mounted duplicate-tile/reconnect/cleanup tests. Legacy readiness probe/subscription still needs reconciliation. |
| Turn rendering | Pure projection/rows; final-only actions; original expanded chronology; promptless/steered turns; compaction/background exceptions; stable native tool keys. Actual timeline fixture confirms footer count 1 → 0 → 1 through settled/active/settled. | Long-history fold expansion, trailing/background activity and real Dockview/Artifacts QA. |
| Reasoning/activity | Explicit Thinking separate from tools; truthful unfinished/stopped/declined/failure counts; task identity/ownership/diagnostics and runtime plan steps integrated, no per-task lifecycle duplicates. | Full provider-exposed reasoning/task variants, input-waiting phase and supported agent navigation/capability review. |
| Questions/approvals | Native `string \| string[]` codec in both UI paths and controller; multi-select/native values/free-text/durable retries; exact approval options/app identity. | Mounted blocking/async keyboard/focus and concurrent-tile tests. |
| Media/rich output | Native attachment variants; shared signed asset expiry/retry/cancellation; image/audio/video, file citations and validated assistant quotes; Cozea gallery retained. 14 media/mapper tests, source-component Electron image/table/copy proof. | Native authorized asset round trip; complete supported directive/template grammar/actions and quote navigation review. Unsupported forms remain readable. |
| Performance | Incremental text/attachment projector, conservative invalidation tests, stable render callback/context; realistic 10k-entry wrapper pipeline measured; report under docs. | Current full DOM/reveal/Markdown/scroll profile, simultaneous tiles and large expanded folds. |

Verification at this checkpoint:

- Full root tests: **2,206 passed, 7 skipped** (288 files passed, 2 skipped).
- Isolated pinned provider/orchestration/persistence compatibility suites:
  **1,564 passed, 8 skipped** (122 files passed, 2 skipped).
- App/test/Electron typechecks, lint, production build, pin/contracts/suppression
  compatibility and diff whitespace checks passed during integration.
- Earlier setup failures (missing Electron binary, skipped Effect patch, missing
  vendored dependencies) were resolved using the existing Electron installer,
  root postinstall and `prepare:t3-runtime`. No new dependency or lock change.
- Existing Vite configuration, SQLite experimental and static/dynamic-import
  warnings remain. No live native-provider or paid prompt was executed.
- Browser plugin absent. Bundled Playwright controlled an isolated Electron
  fixture at 1100×900 and 390×844, importing current source components. Identity,
  meaningful content, no framework overlay, task/native/tool disclosures, exact
  code copy (mock clipboard), image expansion, table and narrow overflow checks
  passed. Only the fixture development CSP warning was captured.
- Evidence/scripts: `/tmp/cozea-rendered-qa.gUx210/` (`proof.json`,
  `wide-expanded.png`, `narrow-expanded.png`). These are component fixtures, not
  full Cozea/provider qualification. Vite was stopped; isolated Electron PID
  71171 remains available on CDP 43192 for parent follow-up.

The goal remains active. Commit review, full acceptance, feature push and GitHub
PR are not complete; no merge, deployment, main push or production mutation occurred.

## Review-ready acceptance — 2026-09-05T07:36Z

This section supersedes the implementation checkpoints above. All six source
phases are integrated; no known reproduced correctness defect remains open in
the tested scope. Final feature commit/PR details belong in the delivery record.

| Area | Accepted evidence | Qualification limit / intentional Cozea adaptation |
| --- | --- | --- |
| Canonical state | Native detail and legacy full-read-model paths now share one typed reducer. Seven failing-before legacy fixtures reproduced premature text completion, old-turn checkpoints and terminal revival; eleven new legacy tests pass. Independent review plus 29 focused tests found no further state defect. | Shell owns metadata/session/latestTurn on the native path; loaded detail owns arrays. No backend or persistence migration. |
| Transport | Native/legacy readiness retries, snapshot bootstrap/replay, same-thread accepted revision gate, fresh tickets, late cleanup and no command replay. Shared endpoint discovery has one refcounted serialized loop, stable equal snapshots, late-subscriber state and final-release cancellation. Deterministic lifecycle/fake-WebSocket tests pass. | Actual native server restart/network qualification is not claimed. No auth/main-process change. |
| Turns and actions | One terminal footer, stable native tool identity, promptless/steered continuity, original fold chronology and trailing activity before actions. Actual Electron DOM/accessibility inspection caught and verified the footer-anchor fix. | LegendList's own DOM-order debounce can leave a transient ordering window during churn; settled order agrees. |
| Activity and thinking | Native task ownership keeps child/background actions outside parent counts; nested anchors, orphan/bypass groups, failures and original payloads remain accessible. Parent reasoning ignores attributed child markers (failing-before regression). Expanded owned actions are 24px, lazily expose payloads and own shimmer. Runtime plans use native steps. | Native agent IDs are not Cozea tile IDs. Task disclosures are the supported inspection surface, not an invented Agents-panel route. Only provider-exposed reasoning is displayed. |
| Requests | Mounted blocking/async controls and actual Cozea Surface/Lexical pass native multi-select, duplicate labels, free text, scoped keys, lost-ack exact retry, independent tiles and exact approval choices. Template action and question text preserve ordinary draft/caret; blank Enter cannot advance/submit. | Controller/backend callbacks in the mounted fixture are mocked; paid/live-provider question submission is unverified. |
| Content | Actual Markdown/GFM/table/code-copy/media fixtures pass. Pinned pure directive grammar handles mixed Markdown/entities; unsafe template identifiers remain readable. Template cards append/focus the ordinary draft without auto-submit. Attachment variant/cache tests pass. | Authorized asset round trip against a native provider is unverified. Quotes/comments remain readable with explicit unavailable source navigation; Cozea lacks native environment/thread/range targeting. |
| Performance and lifecycle | Two 100-message timelines pass paced/exact reveal, stable summary node, one footer, pixel-identical reading anchor, bottom following, hidden/reduced-motion and no unrelated tile commits. Presentation-only commits exclude MessagesTimeline. Large folds are individually virtualized; positive-control entrance tests prove no replay after recycle/reopen. | Actual OS document hiding, packaged build profiling and full Dockview/Artifacts interaction remain unverified; visibility inputs were directly exercised and source wiring retained. |

Final broad verification checkpoint:

- Root suite: **2,266 passed, 8 skipped**, 296 files passed / two skipped.
- Pinned compatibility suite: **1,564 passed, 8 skipped**, 122 files passed / two skipped.
- App, tests and Electron typechecks; lint; production build; pin/contracts and
  whitespace checks pass. Existing Vite configuration/static-dynamic import and
  experimental SQLite warnings remain; no unrelated test failures were found.
- The earlier full run's single failure was the intentionally failing-before
  child-ownership fixture being authored concurrently; it is fixed and the
  subsequent complete suite is green.
- No new package/lockfile, vendor pin/source, public protocol, provider enablement,
  main-process/auth/schema, deployment or production-data change. The pure parser
  bridge uses already-locked vendor dependencies and was verified in the production
  renderer build. Fresh development/CI uses existing `bun run bootstrap`.

### Rendered QA record

Browser plugin unavailable; existing bundled Playwright controlled isolated
Electron (CDP 43192) and Chromium against `http://127.0.0.1:43191`. Real app on
port 9222 and real conversations were untouched. Viewports included 1100×900,
390×844, two tiles within 600px, full Surface 1100px and owned-task 900×700.

| Required check | Result |
| --- | --- |
| Intended URL/title and meaningful screen | Pass on each fixture entry route |
| Framework error overlay | None |
| Console/page errors | None relevant; isolated Electron dev CSP warning recorded |
| Visual evidence | Parent inspected wide/narrow, footer, Surface draft/template and owned-action screenshots |
| Interaction proof | Expand/collapse, native/raw details, code copy, image expansion, template use, request selection/typing/Enter/retry, tile switching and scroll anchors passed |
| Performance attribution | Presentation-only work remains in body/Markdown and list layout; no timeline or unrelated tile render |

The Surface fixture needed an explicit production-CSS `@source` directive in its
temporary harness. An initial zero-width editor was a harness omission, not an
application defect; it disappeared with complete production utility generation.
All subsequent Surface checks used the corrected harness.

Temporary artifacts under `/tmp/cozea-rendered-qa.gUx210/` include `proof.json`,
`stress-proof.json`, `stress-extra-proof.json`, `fold-order-proof.json`,
`accessibility-proof.json`, `presentation-proof.json`, `large-proof.json`,
`large-virtual-proof.json`, `entrance-replay-proof.json`, and replay drivers
`surface-requests-check.mjs`, `requests-check.mjs`, `owned-check.mjs`.
Screenshots include `wide-expanded.png`, `narrow-expanded.png`,
`fold-order-fixed.png`, `surface-requests-verified.png`, and `owned-verified.png`.

Provider replay fixtures cite distinct pinned Codex, Claude, OpenCode, Cursor and
optional Antigravity mappings. They exercise the normalized renderer boundary,
not the native adapters themselves. Snapshot parity reloads canonical replay
state, not an independently captured native snapshot. An explicit skipped live
variant prevents these fixtures being mistaken for runtime qualification.

## Delivery

Implementation commit: `aebf7a46` on `codex/conversation-rendering-parity`.
[PR #142](https://github.com/Cozea/electron-app/pull/142) is open for review against
`main`, not draft. GitHub reported it mergeable at the initial delivery check;
CodeRabbit was pending. Local verification above is not a claim that remote CI
or automated review has completed. Nothing was merged or deployed.

## CodeRabbit follow-up — 2026-09-05T08:21Z

The review on `23d1654e` reported 11 actionable comments and 11 nitpicks. This
follow-up supersedes the earlier no-known-defect checkpoint for those findings.
All code findings were checked against current source, not accepted as agent
instructions. The following fixes and regressions are included:

| Finding | Resolution and evidence |
| --- | --- |
| Automatic provider-media network requests | HTTP(S) media now renders an explicit external link. Classifier and actual Markdown/attachment rendering regressions cover images/audio/video. Isolated Electron observed zero automatic requests; one explicit click reached the controlled loopback endpoint. |
| Signed media traversal | Existing runtime preparation applies an idempotent, uniquely anchored server bundle patch. Generic media requires a workspace and uses the native canonical workspace resolver for absolute/relative paths. Executing the real bundled mint branch against temporary files reproduced traversal before the fix; twelve filesystem cases now cover valid media, escaping paths/symlinks, absent context, disguised types and directories. Test returns before signing; it does not launch a server or provider. |
| Null session update | Reject before canonical reduction; existing data/revision stay intact. Fake-frame subscription integration verifies disposal and authoritative snapshot recovery. |
| Missing checkpoint turn count on revert | Positive ambiguous reverts request resynchronization instead of deleting or guessing. Zero/full-numbered reverts retain deterministic behavior. Failed-before and actual subscription-owner/store regressions pass. |
| Reused tool-call row keys | JSON native-identity tuples plus per-identity occurrence keys keep row mappings, child keys, folds and footers distinct. Unit and actual Electron accordion checks cover calls separated by commentary/final text. First live-to-completion identity remains stable. |
| Per-question cursor | Thread/request/question keyed cursors with resolved-request cleanup. Actual Surface/Lexical baseline restored A to the end (14 instead of 3); fixed A/B navigation restores 3/9, preserves both drafts and ordinary composer cursor, sends nothing. |
| Legacy shell connection notice | Subscribe using the active transport endpoint; native media/detail eligibility remains independent. Explicit source-wiring regression passes. |
| Stale legacy readiness state | Reset fallback eligibility for each attempt; failed-before fake-clock lifecycle regression now reports the failure. |
| Timeout diagnostic | Reject timeout before generic disposal rejection; fake-WebSocket test preserves the specific error. |
| Imports/package API | Requested aliases/order corrected, shared reducer symbols exported through the package entry point, checkpoint reference uses its branded type. |

All eleven nitpicks were also addressed: test setup ordering and typed message
patches, the requested import sites, named attachment variants/shared fields,
linear local owned-event appending, and a shared internal-activity predicate.
CodeRabbit's separate default 80% docstring-coverage advisory is not a repository
test failure; no blanket comment generation or review-threshold change was made.

Verification: **2,289 root tests passed, 8 skipped**; **1,564 pinned compatibility
tests passed, 8 skipped**; app/test/Electron typechecks,
lint, production build, runtime preparation/check, provider pin/contracts and
whitespace checks pass. A preliminary run overlapped deliberately failing-before
containment tests; the complete post-fix run is green. Existing Vite/SQLite/import
warnings remain. No new dependencies, lockfiles, vendor source/pin changes,
Electron main/bootstrap edits, credential-flow or database migrations.

Rendered follow-up uses the frontend-testing workflow; Browser plugin unavailable,
so existing bundled Playwright controls isolated Electron/Chromium on
`http://127.0.0.1:43191`. The flow is Markdown render → no implicit network request
→ explicit external-link click; local image expansion and repeated-tool disclosure
also remain usable. URL/title/content, no framework overlay, console health,
interaction and screenshots pass at 1100×1000 and 390×844. Question-caret testing
uses actual Surface/Lexical with mocked controller callbacks at 1100×1000.
Evidence: `/tmp/cozea-rendered-qa.gUx210/media-security-{check.mjs,proof.json,wide.png,narrow.png}`
and `cursor-{check.mjs,verified.png}`. The real app on port 9222 remains untouched.
Live-provider submission, a complete native asset-signing HTTP round trip,
packaged-app and full Dockview/Artifacts qualification remain unverified.

# D27 — Concrete Cozea integration, source ownership and packaging seams

**Purpose:** implement the design in the actual application without accidental parallel runtimes or premature public distribution. **Pinned baseline:** Cozea `8e65b729…`, design branch `b8852de1…`, T3 `be4668f7…`. **Source facts:** inspected host service, catalogue patch, native package and T3 toolkit; see D01. **Platform sources:** [S09–S10](29-research-register.md#s09), [S22–S26](29-research-register.md#s22).

## 1. Target repository layout

```text
packages/aid-contracts/          canonical IDL, generated codecs/types/tool schema
packages/aid-sdk/                guest proxy library and approved pure modules
packages/aid-host/               workspace/control/execution/evidence/journal adapters
packages/aid-testing/            portable simulators, contract vectors, fault drivers
native/computer-use-runtime/     retained/reworked portable Swift core + native devices
  Sources/CozeaAIDDriver/        new GUI driver executable target
native/aid-worker/               XPC shim + Rust Wasmtime host + QuickJS guest build
native/aid-driver-launcher/      narrow authenticated launch/IPC host bridge
apps/desktop/electron/services/  compatibility facade and trusted policy wiring
apps/desktop/src/...             supervisory UI within existing chat/workbench architecture
scripts/prepare-aid-runtime.mjs  build/sign/resource/profile preparation
scripts/check-aid-runtime.mjs    read-only package/profile validation
scripts/patch-aid-toolkit.mjs    exact reviewed T3 source integration while fork lands
 tests/aid-system/               cross-layer/permissioned fixtures and qualification
```

These are selected new paths, not claims they already exist. Do not create a second copy of AX/capture/input code under a new name; move/extract the existing implementation behind the new contracts and preserve its provenance/tests.

## 2. Existing file mapping

| Existing source | New responsibility / change |
| --- | --- |
| `ComputerUseRuntimeService.ts` | thin facade to AidHost, policy/settings and compatibility during development; remove9-tool execution authority at cutover |
| `ShadowServerManager.ts` | pass authenticated AID endpoint/capability profile to the existing shadow T3 instance |
| `registerComputerUseHandlers.ts` | diagnostics, permission UI and supervisory IPC through validated sender context |
| `registerScheduledTaskHandlers.ts` | bind scheduled grants/denials to logical control epochs |
| `shared/electronApiTypes.ts` | typed host supervision/capability projection, not raw guest/native objects |
| `CozeaComputerUseCore/Resources/tools.json` | legacy comparison table until generated six-tool catalogue replaces it |
| `MacComputerRuntime.swift` | split authority, operation routing and observations; no implicit transport session ownership |
| `WindowRegistry`/`AppDirectory` | candidate-first identity/focus/bootstrap services |
| `CaptureRuntime`/`WindowStream` | owner-scoped capture/frame services |
| `ActionRouter`/`PublicEventBackend` | shared motor/keyboard backend contracts and receipts |
| `CursorController`/glyph renderer | true-hotspot adaptive presentation |
| `packages/computer-use-native`, C ABI2 bridge | comparison shim until new driver IPC is qualified; do not expose both as competing writers |

Read current exact source before implementation; unrelated branch changes may move these seams. The implementation agent must update the mapping manifest rather than guessing from a stale line number.

## 3. T3 source ownership

The pinned raw `apps/server/src/mcp/toolkits/computerUse.ts` still contains legacy table/annotations. Cozea's `patch-computer-use-contract.mjs` replaces the effective table from native JSON. It does not implement asynchronous execution, new authority lifetimes or checkpoints. A schema-only patch is therefore insufficient for this work.

Preferred final integration is a reviewed Cozea/t3code source change with an updated gitlink and compatibility manifest. During development an exact deterministic patch may introduce the AID toolkit/host client at the current pin. Its input hash/anchors must be checked and output reproducible. `--check` must never write. Patch source and real bundled server tests both run; do not patch only a cached compiled bundle and leave source divergent.

Keep root and vendor Effect dependency trees separate. The current snapshots expose different APIs; do not “fix” imports by repinning unrelated packages or adding broad typecheck suppressions. Use the versioned vendor APIs already present and run its own typechecks/tests through the declared package manager.

## 4. Cozea identity and UI integration

Use the existing device principal `identityKey` and authenticated invocation tuple. Do not create a parallel human-user account layer or public `deviceId`/`userId` aliases. Project and thread are scopes, not credentials. Host control grants derive from verified policy and scheduled task authorization.

Integrate supervisory state with `WorkbenchAssistantChatTile`/`CozeaChatSurface` and their existing controllers. Hidden chat/artifact views must not unmount the runtime control owner. Use established workbench portal/layer rules and the single T3 browser webview host. No new `WebContentsView` or alternate browser automation surface is introduced by AIDs.

## 5. Build and resource manifest

The runtime manifest records contract version/hash, source commits, worker/engine/driver versions, architecture, minimum OS, binaries/resources digests, code-signing identities, selected isolation profile and qualification profile IDs. Startup verifies architecture, signature/resource identity and contract compatibility before launching a worker/driver. A failed check disables AIDs with a precise diagnostic; it must not silently load an old addon.

Build driver `.app` and worker `.xpc` inside Cozea's bundle at the D04 paths. Sign nested components in correct inside-out order with minimal entitlements; do not use `codesign --deep` as a substitute for correct signing. Hardened runtime, App Sandbox, TCC and notarization are separate checks. A helper's permissions must be verified on the actual signed app, not assumed from Electron grants.

Wasmtime code generation/executable-memory requirements must be tested against hardened runtime before engine selection. Do not add broad JIT/library-validation exceptions without identifying the exact required behavior and a security ADR. Native QuickJS fallback is a prescribed separate profile, never an automatic insecure fallback.

Swift6.3 `@c` may simplify generated C declarations in the launcher/worker shim, but the protocol/ABI remains versioned. Compile against the selected SDK and minimum deployment target; language feature availability does not imply every OS API is back-deployable.

## 6. Development and cutover

Use one development setting selecting `legacy-comparison` or `aid-environment`, with mutual exclusion at the seat authority. Legacy exists only for A/B baseline and is removed at W35 after qualification. No permanent fallback that silently changes tools/state semantics. Keep migration small outside Computer Use: no unrelated collaboration/database schema changes.

Existing userData settings can be reset for this pre-user cutover only through an explicit development migration plan. Preserve disabled/scheduled-deny behavior until replacement grants are initialized; never default formerly disabled Computer Use to active control. Public release configuration remains unchanged by documentation or ordinary branch pushes.

## 7. Future npm/MCP seam

Do not publish packages now. Keep pure contracts/SDK free of Cozea UI imports, host policy adapters explicit and native distribution/platform dependencies isolated. A future npm package may contain SDK/launcher metadata, and a future standalone MCP host may reuse AidHost. Neither decision should leak transport identity into device control or force native binaries into a speculative packaging format.

## 8. Tests and commands

Proposed implementation scripts: `bun run aid:generate`, `aid:check`, `test:aids`, `prepare:aids`, `prepare:aids:check`, plus native Swift tests, existing Electron/renderer typechecks and real pinned T3 bundle validation. These names are to be added by W03/W32; they are not asserted to exist today. Run repo baseline commands as documented, with genuine macOS tools for AppKit/signing.

**INT-01:** clean locked build produces verified manifests/resources. **INT-02:** relocated packaged app loads driver/worker without source-tree paths. **INT-03:** source/bundle tool catalogues agree. **INT-04:** check mode is read-only. **INT-05:** legacy and AID cannot both own input. **INT-06:** scheduled denial survives cutover. **INT-07:** no additional browser host appears. **INT-08:** signed helper permissions are explicit. **INT-09:** public package publication is absent. **INT-10:** removal of legacy leaves no tool bypass or obsolete permission paths. G01/G03 and packaged smoke tests gate cutover.

# macOS Computer Use v2

## Scope and invariants

Computer Use is macOS 14+ only (arm64 and x86_64 build targets); the rest of Cozea remains cross-platform. The implementation is a repository-owned SwiftPM package, an in-process C ABI 2 bridge, a thin Rust N-API adapter, and the authenticated loopback broker already used by T3. It does not install a CLI or edit provider home configuration. Accessibility and Screen Recording authority remains with the signed Cozea process.

A pointer operation resolves a retained observation lease, acquires an explicit input permit, visibly moves the native software cursor, waits for arrival, revalidates the exact target, and only then submits input. Cursor animation uses AppKit display links and layer-backed per-display surfaces. There is no nested run-loop pump or synchronous main-thread animation. A missing/cancelled cursor prevents input. Keyboard input shares the mutation permit because focus and modifier state are desktop-wide resources; reads do not wait on that permit. Swift actor isolation alone is not used as a transaction lock.

`get_app_state` is the only screenshot/tree operation. The seven action tools return a small acknowledgement; they never take an implicit screenshot or traverse a full AX tree. An action without an observation returns `STATE_REQUIRED`. An invalid/recycled/moved target returns `STALE_ELEMENT`, `STALE_WINDOW` or `STALE_OBSERVATION`; the runtime never silently remaps an old index. Typing respects the current caret/selection instead of appending a stale AXValue. `set_value` never falls back to typing or clipboard.

## Components

- `native/computer-use-runtime/Sources/CozeaComputerUseCore`: typed requests, exact tool schemas, bounded leases, explicit input permits, synchronous authorization/revocation, cancellation, observation/command clocks and compact results.
- `CozeaComputerUseRuntime`: native window identity, AX observers/renderer, persistent capture, causal cursor, action routing, isolated SkyLight SPI and redacted timing telemetry.
- `native/computer-use-bridge`: C ABI, with worker-only waiting for asynchronous Swift operations. `cozea_computer_use_abi_version` and the four-argument call prevent accidentally loading the old three-argument ABI.
- `packages/computer-use-native`: FFI string ownership and asynchronous worker dispatch. No process-wide Rust lock; permission requests and policy revocations are deliberately synchronous.
- `ComputerUseRuntimeService.ts`: settings/scheduled policy, native revision snapshots, cancellation on HTTP disconnect, and lifecycle teardown barriers. Policy is never communicated through mutable environment variables.

## Observation and capture

Each snapshot has an immutable `snapshot_id`, window PID/CGWindowID/generation, retained AX handles, screenshot coordinate transform and separate observed/command revisions. Actions accept an optional snapshot_id; omission selects the latest lease for that session/app. Coordinates always refer to the image returned with that lease, not global display coordinates. Coordinate reuse after any Cozea input requires re-observation. Element reuse requires current identity/label/geometry validation.

AX notifications are scoped to the observed window. Command dispatch cannot satisfy a wait for observed UI change. An acknowledgement's `ok` means input submission succeeded; `state_changed` reports actual notification evidence, not invented application success. The model must observe navigation, menus, dialogs and other uncertain transitions.

At most two identity-bound `SCStream` instances are warm. Keeping one callback sink bound to one window avoids relabelling in-flight frames when switching targets. Streams expire after 15 idle seconds and are released at session end/reset. They capture at 15 fps, at most 1280 pixels on the longest edge, retain one pixel buffer, and encode once per requested image. A warm stream does not rediscover SCShareableContent. Frames must have capture-time evidence newer than preceding input; stale frames are not silently returned as post-action observations. A bounded one-shot fallback is available. Tree and image collection run concurrently and retry consistency at most once. Incoherent observations cannot authorize input.

The PNG budget is 3 MiB, not an unbounded repeat-resize/encode loop. Trees retain the upstream formatter with node/depth/text/time budgets; subtree mutation caching is intentionally not implemented without profiling evidence.

## SkyLight routing and safety

Auto-click routing is unambiguous semantic AX, then eligible SkyLight left-click, then PID-targeted Core Graphics. Global pointer delivery requires the explicit `global` method, the user's advanced permission, and a foreground target. It is never a silent fallback from uncertain targeted delivery.

SkyLight is Apple's private framework, **not** OpenAI's `@oai/sky` SDK. Symbols are resolved dynamically in `Sky/`; macOS major versions outside the supported compatibility range or `COZEA_CU_DISABLE_SKY=1` disable it. Symbol presence is not proof of app compatibility. The conservative upstream 41c5294 click recipe, including primer/focus delays and its dual event channels, is retained. Timings are not shortened on hypothetical benchmarks. The recipe's potentially side-effecting phase is tracked; after focus/input submission, an error becomes `DELIVERY_UNKNOWN` and may not trigger a second backend or automatic retry. Mouse-up and synthetic-focus cleanup are attempted during cancellation.

AppKit/WebKit/Chromium/Catalyst background delivery, right clicks and drag behavior require the live matrix below. No claim of universal focus-preserving delivery is made. Private SPI does not bypass TCC, disable SIP, inject into other processes, or require undocumented entitlements.

## Cancellation and lifecycle

Electron allocates monotonic policy revisions and request IDs. Native authorization is checked on admission and immediately before dispatch; settings changes synchronously cancel old controls before async teardown. A cancel arriving before worker admission is remembered. Duplicate in-flight IDs coalesce, small completed acknowledgements/tombstones are bounded, and an ID reused with different arguments is rejected. Images are not retained in the dedup cache.

Turn end/reset cancels and drains in-flight work before releasing leases/capture/observers. New host calls wait for teardown and then re-read live policy. Scheduled allow becomes deny on reset; master disable or disabled capabilities cannot be bypassed by a scheduled policy. HTTP disconnect/deadline cancellation does not retry input. Acknowledgements/errors distinguish not-dispatched versus uncertain delivery.

## Building and checks

```
bun install --frozen-lockfile --ignore-scripts
bun run prepare:computer-use
bun run prepare:computer-use:check
bun run test:computer-use
xcrun swift test --package-path native/computer-use-runtime
bun run typecheck:electron
bun run typecheck
```

Preparation builds the requested profile/architecture, validates Mach-O architectures, and ships the N-API addon, bridge dylib, tool-catalogue resource bundle, license notice and ABI/source/artifact-hashed manifest. Non-Mac preparation creates only an unsupported manifest/notice; no upstream npm worker is installed. A clean source build does not fetch upstream LFS research binaries.

T3's source and cached bundle tool table are patched from the same `Resources/tools.json` through `scripts/patch-computer-use-contract.mjs`. The patch is idempotent and fails on a missing/ambiguous anchor. The provider runtime and contracts pin is unchanged. Changes to the nine-tool schema must update the canonical resource and its tests, not another provider-specific copy.

The CI lane runs native tests, bridge build, Intel cross-build, scoped host tests, Rust formatting, addon preparation and a relocated-addon smoke test in Electron. The smoke test sends no desktop input and does not grant permissions. These checks are distinct from live usability/performance validation.

## Permissioned live validation (release gate)

Build/open the AppKit/WKWebView fixture with `bash scripts/build-computer-use-fixture.sh`. Run the Electron fixture with `node_modules/.bin/electron tests/computer-use/fixtures/electron.cjs`. Use the actual signed Cozea app, with permissions granted through System Settings, to control these targets. Do not edit the TCC database or use a synthetic fixture command bridge.

For AppKit, WebKit, Electron, Finder and Safari, exercise click, double-click, context menu, checkbox, caret/selection typing including emoji, set_value, scrolling, menu/dialog navigation and drag. Then test background/covered windows, app/window restart, resize/move during cursor travel, multi-display mixed scale, full-screen/Space transitions, user input conflicts, turn cancellation, permission revocation and settings disable while queued. Verify exact target activation counts, no duplicate delivery, no stuck mouse/modifier state, cursor-before-action ordering, and unchanged real pointer on targeted paths. Any wrong-window action blocks release. Test both Sky enabled and disabled. Do not tune private timing profiles until repeated family-specific runs supply evidence.

Capture 50+ comparable warmed samples for each operation in the signed app. Use Instruments Points of Interest for subsystem `com.cozea.desktop`, category `ComputerUse`, or export debug logs and summarize:

```
log show --last 10m --debug --style ndjson \
  --predicate 'subsystem == "com.cozea.desktop" AND category == "ComputerUse"' > trace.ndjson
node scripts/benchmark-computer-use.mjs trace.ndjson
```

Only stage names, counters and durations are logged; no screen text, typed text, screenshot, token or raw argument payload. Compare observed p50/p95/p99 against the prior runtime on the same Mac, target, model and task. Cursor travel remains intentional; report it separately from dispatch/capture/encoding. Target budgets (not measurements): warm observation p95 450 ms and native post-cursor overhead minimized subject to the conservative Sky recipe. Do not report 10–80 ms Sky delivery or Codex speed parity without measurements.

## Upstream provenance

The repo-owned renderer, motion model, glyph renderer, key parser and private-event recipe are derived from iFurySt/open-codex-computer-use revision 41c5294cfe4735baca03f9c82b4de99d191a0b49. `UPSTREAM.json` records provenance; `LICENSE.upstream.txt` and the packaged notice preserve the MIT license. No OpenAI bundled binary, font or research archive is redistributed.

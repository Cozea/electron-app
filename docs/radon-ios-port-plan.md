# Radon iOS Preview Port Plan

## Goal

Build an iOS-first embedded React Native preview system inside this Electron app that reproduces the useful Radon preview behavior without depending on VS Code surfaces.

Scope for the first serious implementation target:

- macOS host only
- iOS Simulator only
- embedded live preview inside the app
- touch, key, wheel/scroll, rotate, screenshot
- Metro/Babel injection
- app-side runtime bridge
- session lifecycle and reconnects

Explicitly out of scope for the first cut:

- Android physical-device parity
- full Radon tool suite
- AI / MCP / Radon Connect
- exact replay / recording parity
- patching Radon’s shipped binary or licensing logic

## Evidence Boundary

This plan is based on:

- the shipped extracted Radon VSIX at `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64/extension`
- the reverse-engineering notes in [radon-ide-research-notes.md](/Users/admin/Downloads/electron-app-main/docs/radon-ide-research-notes.md)
- the current Cozea preview architecture already present in this repo

The plan intentionally separates:

- **Copy / portable from exposed Radon code**
- **Adaptable from current Cozea code**
- **Native / from-scratch because only compiled behavior is available**

## What Radon Already Exposes Well Enough To Port

These are the pieces where the shipped JS is readable enough that porting or close adaptation is the safest path.

### 1. Metro / Babel injection layer

Source modules:

- `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64/extension/lib/metro_helpers.js`
- `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64/extension/lib/babel_transformer.js`
- `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64/extension/lib/preview.js`

What is good to port:

- the `__RNIDE_lib__` extra-module strategy
- transformer wrapping rather than replacing the app’s whole Metro setup
- injecting `runtime.js` from `InitializeCore.js`
- replacing `radon-ide` / `react-native-ide` imports with a local preview module
- keeping app dependency resolution rooted at the app directory
- exposing watch-folder and reporter integration points

What should not be copied blindly:

- all third-party plugin integrations in `babel_transformer.js`
- the React Native renderer replacement matrix for every RN version before we need it
- Storybook, Apollo, React Query, Redux, MMKV integrations

Practical decision:

- **Port the structure almost directly**
- **Trim it to preview-only behavior first**

### 2. App-side runtime bootstrap

Source module:

- `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64/extension/lib/runtime.js`

What is good to port:

- `global.__RNIDE_enabled` style runtime marker
- console wrapping with source-location preservation
- wrapper-component interception via `AppRegistry.setWrapperComponentProvider`
- nested-wrapper handling when the app already has its own wrapper
- global registration hooks for preview / devtool plugins

This is one of the strongest copy candidates because:

- it is readable
- it is not editor-specific
- it is central to parity
- writing it from scratch would likely regress subtle behavior

Practical decision:

- **Port very closely**
- rename globals and paths for this app, but keep the behavior model

### 3. App wrapper and runtime protocol semantics

Source modules:

- `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64/extension/lib/wrapper.js`
- `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64/extension/lib/inspector_bridge.js`
- `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64/extension/lib/react_devtools_agent.js`
- `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64/extension/lib/preview.js`
- `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64/extension/lib/dimensions_observer.js`
- `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64/extension/lib/orientation/orientation.js`
- `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64/extension/lib/inspector_availability.js`

What is good to port:

- the reliable message bridge with `id` / `ack` / `retransmit`
- the `RNIDE_message` transport model over React DevTools
- preview registration and lookup via `global.__RNIDE_previews`
- preview key format `preview:/<file>:<line>`
- `openPreview`, `openNavigation`, `openUrl`, `inspect`
- `appReady`, `navigationChanged`, `inspectData`, `devtoolPluginsChanged`
- normalized dimensions/orientation observation
- wrapper-driven re-mount behavior using `AppRegistry.runApplication`

What should be adapted rather than copied verbatim:

- naming
- plugin registration surface
- error reporting destination
- any `storybook`-specific behavior
- devtools/tool-panel hooks that do not matter for preview

Practical decision:

- **Port most of the protocol and wrapper behavior**
- **strip all tooling unrelated to preview**

### 4. Helper command protocol boundary

Source evidence:

- `dist/extension.js` preview controller sections around `stream_ready`, `fps_report`, `video_ready`, `screenshot_ready`, `touch`, `key`, `button`, `paste`, `wheel`, `rotate`, `copy_screenshot`

What is good to port:

- the line-based helper protocol shape
- plain-text command emission
- event parsing model
- transform rules for touch coordinates across device rotation
- screenshot / recording / replay orchestration state machine at the JS boundary

What should not be copied wholesale:

- VS Code-specific lifecycle wiring
- license-token handling
- Radon panel event emitters

Practical decision:

- **Port the helper protocol almost exactly**
- but own the process management and state in Electron services instead of in VS Code classes

## What Should Be Adapted From This Repo Instead Of Rewritten

These are existing Cozea pieces that already solve adjacent problems and should anchor the port.

### 1. Electron IPC structure

Current files:

- [registerPreviewHandlers.ts](/Users/admin/Downloads/electron-app-main/electron/ipc/registerPreviewHandlers.ts)
- [preload.ts](/Users/admin/Downloads/electron-app-main/electron/preload.ts)
- [electronApiTypes.ts](/Users/admin/Downloads/electron-app-main/shared/electronApiTypes.ts)

Why they matter:

- they already define the pattern for main-process services exposed to renderer code
- they already isolate renderer from raw Electron APIs
- they are a better local fit than porting any VS Code transport surface

Practical decision:

- **mirror the existing `preview:*` IPC style for `nativePreview:*`**

### 2. Embedded preview surface

Current files:

- [FocusedProjectPreview.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/previews/FocusedProjectPreview.tsx)
- [ProjectPreviewToolbar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/previews/ProjectPreviewToolbar.tsx)

Why they matter:

- `FocusedProjectPreview` already gives us a viewport shell with pan/zoom affordances
- `ProjectPreviewToolbar` already gives us a solid toolbar shell for preview actions

What to adapt:

- replace the iframe with an `<img>` / media-backed viewport for MJPEG
- translate pointer/gesture input into helper commands instead of iframe bridge messages
- keep the visual shell, loading states, toolbar affordances, and open-externally patterns

Practical decision:

- **reuse the shell**
- **replace the transport**

### 3. Bridge bootstrap pattern

Current files:

- [previewBridgeBootstrap.ts](/Users/admin/Downloads/electron-app-main/shared/previewBridgeBootstrap.ts)
- [previewBridge.ts](/Users/admin/Downloads/electron-app-main/src/utils/previewBridge.ts)

Why they matter:

- they already model “host injects helper runtime into the preview target”
- the RN preview runtime needs the same ownership model even though the injected target is Metro/RN instead of a web iframe

Practical decision:

- **reuse the pattern, not the exact code**

### 4. Native-mode dev-server selection hooks

Current files:

- [projectDetector.ts](/Users/admin/Downloads/electron-app-main/src/utils/projectDetector.ts)
- [ServerControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ServerControl.tsx)

Why they matter:

- they already acknowledge `previewMode: 'native'`
- they already prefer `ios` / `start` scripts for RN and Expo when in native mode

Practical decision:

- **extend existing native preview mode rather than creating a separate app-level concept**

## What Cannot Honestly Be Copied And Must Be Reimplemented

### 1. iOS simulator native helper

This is the core native gap.

We have strong RE evidence for behavior:

- dynamic loading of SimulatorKit/private simulator symbols
- `SimulatorControl` object with frame callbacks
- `IOSurface -> CVPixelBuffer`
- native JPEG and native H.264 encoders
- Indigo HID event construction for touch/key/button
- Purple-based simulator rotation/control path

But the source is not exposed in the package.

Practical decision:

- **must be implemented from scratch in a new native helper**
- Rust is likely the best match because the recovered helper strongly looks Rust-based
- Objective-C / Objective-C++ shims may still be required for private framework interaction

### 2. Final helper media internals

We know enough for behavior, not enough to lift source:

- MJPEG is the proven live-preview path
- H.264 exists as a secondary downstream video path
- screenshot/export paths are native

Practical decision:

- **start with JPEG/MJPEG only**
- leave H.264, recording, and replay as later parity work

### 3. VS Code panel / project orchestration layer

Files like `dist/panel.js` and large parts of `dist/extension.js` should not be ported directly.

Why:

- they are editor-specific
- they are minified/bundled
- the ownership model does not match this app

Practical decision:

- **rebuild the orchestration layer in Electron using the recovered semantics, not the editor code**

## Recommended Target Architecture In This Repo

The cleanest approach is to add a parallel native-preview subsystem instead of mutating the existing web-preview code until it becomes ambiguous.

### Shared types

Create:

- `shared/nativePreviewTypes.ts`

Responsibilities:

- device/session state
- helper command names
- helper event payloads
- orientation enum
- screenshot result type
- stream state
- touch/key/button/wheel payloads

### Electron main: service layer

Create:

- `electron/services/nativePreview/NativePreviewManager.ts`
- `electron/services/nativePreview/IosSimulatorSession.ts`
- `electron/services/nativePreview/IosSimulatorHelper.ts`
- `electron/services/nativePreview/NativePreviewStateStore.ts`
- `electron/services/nativePreview/nativePreviewProtocol.ts`

Responsibilities:

- one active iOS simulator preview session per project/device
- spawn and own the helper process
- parse helper stdout/stderr lines
- expose stream URL and session state
- translate renderer input into helper commands
- manage screenshot and rotation
- reconnect / restart behavior

### Electron main: IPC registration

Create:

- `electron/ipc/registerNativePreviewHandlers.ts`

Responsibilities:

- register `nativePreview:*` handlers
- expose session start/stop
- expose stream status
- expose input commands
- expose screenshot and rotation actions

Expected handler surface:

- `nativePreview:startSession`
- `nativePreview:stopSession`
- `nativePreview:getSessionState`
- `nativePreview:sendTouches`
- `nativePreview:sendWheel`
- `nativePreview:sendKey`
- `nativePreview:sendButton`
- `nativePreview:rotate`
- `nativePreview:captureScreenshot`
- `nativePreview:copyLastScreenshot`
- `nativePreview:onStateChanged`

### Electron preload

Extend:

- [preload.ts](/Users/admin/Downloads/electron-app-main/electron/preload.ts)
- [electronApiTypes.ts](/Users/admin/Downloads/electron-app-main/shared/electronApiTypes.ts)

Responsibilities:

- expose the `nativePreview` API namespace to the renderer
- mirror the same guarded preload style already used for `preview`

### Renderer state

Create:

- `src/stores/useNativePreviewStore.ts`

Responsibilities:

- current simulator device/session
- stream URL
- connection status
- screenshot progress
- rotation
- last error

### Renderer UI

Create:

- `src/features/projects/components/native-preview/IosSimulatorPreview.tsx`
- `src/features/projects/components/native-preview/IosSimulatorToolbar.tsx`
- `src/features/projects/components/native-preview/IosSimulatorViewport.tsx`

Adapt from:

- [FocusedProjectPreview.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/previews/FocusedProjectPreview.tsx)
- [ProjectPreviewToolbar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/previews/ProjectPreviewToolbar.tsx)

Responsibilities:

- render the MJPEG stream
- translate pointer gestures into normalized device coordinates
- handle zoom/pan locally in the shell
- expose rotate / screenshot / reload UI

### App-side runtime package

Create a new isolated package or folder for the RN app injection layer, for example:

- `native-preview-runtime/metro_helpers.js`
- `native-preview-runtime/babel_transformer.js`
- `native-preview-runtime/runtime.js`
- `native-preview-runtime/wrapper.js`
- `native-preview-runtime/preview.js`
- `native-preview-runtime/inspector_bridge.js`
- `native-preview-runtime/react_devtools_agent.js`
- `native-preview-runtime/dimensions_observer.js`
- `native-preview-runtime/orientation/`

This should be treated as a ported runtime bundle, not mixed into renderer code.

Why:

- it has different execution semantics
- it is much easier to keep Radon-parity behavior if it remains isolated
- it avoids contaminating existing web-preview logic

### Native helper

Create a separate native project, for example:

- `native/ios-preview-helper/`

Suggested internal split:

- `src/main.rs`
- `src/protocol.rs`
- `src/mjpeg_server.rs`
- `src/simulator_control.rs`
- `src/frame_pipeline.rs`
- `src/jpeg_encoder.rs`
- `src/input.rs`
- `src/rotation.rs`
- `src/screenshot.rs`

Plus Objective-C / ObjC++ bridge files if needed:

- `src/apple/SimulatorControlBridge.mm`
- `src/apple/SimulatorKitLoader.mm`

Responsibilities:

- launch in `ios` mode
- bind to one simulator UDID and optional device-set path
- register simulator frame callback
- encode JPEG frames
- host local MJPEG stream
- accept stdin commands
- emit stdout events

## Copy / Adapt / Rewrite Matrix

### Safe to port closely

- `lib/runtime.js`
- `lib/wrapper.js`
- `lib/inspector_bridge.js`
- `lib/react_devtools_agent.js`
- `lib/preview.js`
- `lib/dimensions_observer.js`
- `lib/orientation/*`
- preview-related parts of `lib/metro_helpers.js`
- preview-related parts of `lib/babel_transformer.js`

Reason:

- readable source
- central runtime behavior
- not intrinsically VS Code UI code

### Port structurally, but rewrite around Electron

- preview controller logic from `dist/extension.js`
- helper event parsing/state machine
- launch configuration semantics
- restart / reconnect logic

Reason:

- the semantics matter
- the original ownership model does not fit this app

### Do not try to lift directly

- `dist/panel.js`
- most of `dist/extension.js`
- native helper binary internals
- licensing / token enforcement logic

Reason:

- editor-specific
- bundled/minified
- or not exposed as source

## iOS-First Implementation Order

### Phase 1: establish the new lane

1. Add `shared/nativePreviewTypes.ts`
2. Add `nativePreview` namespace to `ElectronAPI`
3. Add `registerNativePreviewHandlers.ts`
4. Add `NativePreviewManager` skeleton

Success criteria:

- renderer can ask Electron to start/stop a native preview session
- session state can flow back into renderer

### Phase 2: port the RN runtime

1. Create `native-preview-runtime/`
2. Port `runtime.js`
3. Port `inspector_bridge.js`
4. Port `react_devtools_agent.js`
5. Port `preview.js`
6. Port the minimal `wrapper.js` subset:
   - app ready
   - preview registration
   - open preview
   - inspect
   - navigation changed

Success criteria:

- a test RN app can boot with the injected runtime
- preview registration and bridge messages work

### Phase 3: Metro/Babel integration

1. Port minimal `metro_helpers.js`
2. Port minimal `babel_transformer.js`
3. Wire a launch path from Electron into Metro / Expo / RN CLI

Success criteria:

- runtime injection happens automatically
- `preview(...)` registrations can be discovered

### Phase 4: native iOS helper MVP

1. Spawn helper with `ios --id <udid>`
2. implement `stream_ready`
3. implement JPEG frame path
4. implement MJPEG server
5. implement `touch`, `key`, `button`, `rotate`
6. implement screenshot save/copy

Success criteria:

- embedded live simulator image appears in the app
- user input affects the simulator

### Phase 5: renderer viewport

1. build `IosSimulatorViewport.tsx`
2. adapt `FocusedProjectPreview` shell concepts
3. adapt `ProjectPreviewToolbar` concepts
4. add local zoom/pan and coordinate normalization

Success criteria:

- simulator view is embedded cleanly
- toolbar actions work
- interaction feels direct

### Phase 6: session hardening

1. reconnect logic
2. helper crash handling
3. simulator shutdown/restart recovery
4. stale stream recovery
5. screenshot failure paths

Success criteria:

- preview survives normal failure cases without manual cleanup

## What We Should Deliberately Not Do First

- do not start with H.264
- do not start with recording or replay
- do not start with Android physical devices
- do not port tool panels first
- do not intertwine this with existing iframe bridge code
- do not try to reproduce the entire VS Code panel model

The proven shortest path is:

- MJPEG live preview
- iOS simulator input
- runtime injection
- screenshot / rotate
- then parity gaps

## Headless Capture Clarification

The iOS simulator preview can be embedded without a visible Simulator app window because the recovered helper model does not screen-scrape the desktop.

Recovered behavior:

- register simulator screen callbacks
- receive `IOSurface` frames from the simulator runtime
- wrap as `CVPixelBuffer`
- feed native JPEG and H.264 encoders

So the correct mental model is:

- the simulator still renders
- the helper taps the simulator’s own frame pipeline
- our app embeds the encoded output

That is why “headless” and “captured image” are compatible here.

## Honest Risk Register

### Private Apple APIs

The recovered iOS path uses private SimulatorKit-style interfaces. This is fine for a local macOS developer tool, but it is not App Store-safe.

### RN version compatibility

Radon carries specific compatibility patches in `babel_transformer.js` and renderer overrides. We should start minimal, then add compatibility shims only when a concrete RN/Expo version needs them.

### Native helper complexity

This is the one place where we cannot avoid real systems work. The exposed JS can keep us from inventing the wrong runtime behavior, but the simulator bridge itself still has to be rebuilt.

## Recommendation

For implementation quality, the safest policy is:

- port the exposed runtime JS closely
- reuse this repo’s existing Electron/renderer preview structure where it already fits
- rebuild the native iOS helper from scratch

That minimizes both risks the user is worried about:

- unnecessary from-scratch JS where Radon already gives us readable logic
- fake certainty about native behavior where only the compiled helper exists

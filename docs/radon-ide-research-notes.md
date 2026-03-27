# Radon IDE Research Notes

## Scope

These notes are for the specific extracted Radon IDE beta build:

- Version: `1.16.20260304`
- Package: `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64.vsix`
- Extracted extension root: `/Users/admin/Downloads/radon-ide-download/radon-ide-1.16.20260304-darwin-x64/extension`

The old repo-local Radon/native-preview reimplementation was removed from this repo. These notes refer to the external extracted VSIX above, not a bundled copy inside this codebase.

## License Read

For this specific beta/early-access build, the bundled license reads as allowing local use, inspection, copying, modification, and merging, while restricting distribution to third parties without prior written consent from Software Mansion.

Practical read for research:

- Local study and inspection: allowed by the plain text.
- Local modification/experimentation: allowed by the plain text.
- Redistribution: not allowed without prior written consent.
- Scope: limited to the beta/early-access version, not automatically later/final releases.

## High-Level Conclusion

The shipped build is not an opaque black box. A large amount of the useful logic is readable directly in shipped JavaScript, especially under `lib/` and in the extension bundle. Full decompilation was not necessary for the JS side at this stage.

## Package Layout

Main areas of interest:

- `package.json`
- `dist/extension.js`
- `dist/panel.js`
- `dist/connect_runtime.js`
- `lib/metro_config.js`
- `lib/metro_helpers.js`
- `lib/babel_transformer.js`
- `lib/runtime.js`
- `lib/wrapper.js`
- `lib/inspector_bridge.js`
- `lib/react_devtools_agent.js`
- `lib/network/network.js`
- `dist/simulator-server-macos`
- `dist/resources/android/`

## What The Extension Exposes

From the extension manifest:

- main Radon panel
- Network
- Redux
- React Query
- Apollo Client
- MMKV

The package is positioned as a React Native / Expo IDE inside VS Code or Cursor with debugging, previewing, and integrated devtools.

## Extension-Side Architecture

The main extension logic lives in `dist/extension.js`.

Important structure:

- `IDE`
- `Project`
- `DeviceSessionsManager`
- `DeviceSession`
- `ApplicationSession`
- `ToolsManager`

Observed lifecycle:

1. `activate()` initializes the extension singleton state.
2. `IDE` owns config, telemetry, providers, and project selection.
3. `Project` manages app root, launch config, license state, and device sessions.
4. `DeviceSessionsManager` creates and tracks device/app sessions.
5. `ApplicationSession` brings up debugger, devtools, and runtime tool plumbing.

The startup path is roughly:

1. acquire device
2. start Metro
3. boot / build / install / launch
4. attach debugger and tools
5. keep reconnect / restart paths ready

Failover logic is explicit:

- JS reload first
- process restart next
- full device restart last

## Metro / Babel Injection Pipeline

This is the core mechanism for how Radon gets inside the app.

### Metro bootstrap

`lib/metro_helpers.js` and `lib/metro_config.js` patch Metro behavior by:

- exposing `__RNIDE_lib__`
- rewriting resolver/module paths
- swapping in Radon's Babel transformer
- patching the Metro prelude
- forcing custom reporting
- versioning cache behavior

### Babel transformer

`lib/babel_transformer.js` is the central injection point.

It does the important work:

- appends `runtime.js` into React Native initialization
- rewrites preview-related imports
- injects support for Expo Router variants
- wires Apollo / React Query / MMKV / Redux integrations
- swaps React Native internals or renderer/runtime files for compatibility across RN ranges

This is the biggest reason the build is already readable enough without decompilation.

## App-Side Runtime And Bridge

### Runtime bootstrap

`lib/runtime.js`:

- wraps `console.*`
- sets `global.__RNIDE_enabled`
- exposes globals for plugin registration
- registers Radon's wrapper via `AppRegistry.setWrapperComponentProvider`

### Wrapper and control surface

`lib/wrapper.js` handles:

- `openPreview`
- navigation switching
- URL opening
- inspection
- Storybook
- fast refresh
- app-ready signaling

Observed outbound events include:

- `appReady`
- `navigationChanged`
- `inspectData`
- `fastRefreshStarted`
- `devtoolPluginsChanged`

### Bridge transport

`lib/inspector_bridge.js` and `lib/react_devtools_agent.js` show that Radon rides the React DevTools bridge rather than inventing a totally separate in-app socket layer.

Observed protocol characteristics:

- message IDs
- `ack`
- `retransmit`
- custom `RNIDE_message` channel behavior

Plugin traffic is multiplexed through `lib/plugins/PluginMessageBridge.js`.

## Network Tooling

`lib/network/network.js` instruments XHR/fetch and emits CDP-like network events back to the extension.

Notable behavior:

- request/response tracking
- response body retrieval
- IDE-side toggling / tracking control

This subsystem looks more custom than some of the other devtools integrations.

## Panel UI Bundle

`dist/panel.js` is the main Radon webview UI bundle.

It is minified, but the structure is still clear enough:

- generic RPC over `window.postMessage`
- `call` / `callResult` style messaging
- callback ID bookkeeping and cleanup
- remote `Project` proxy
- `projectStateChanged` subscriptions
- forwarding browser `console` output and uncaught errors back to the extension

The UI surface appears to cover:

- device preview
- launch configuration
- inspector
- tool toggles
- screenshots / replay / recording
- CPU and React profiling
- Maestro
- Radon Connect
- feature/license gating

## Connect Runtime

`dist/connect_runtime.js` is a small binding shim.

Observed behavior:

- `postMessage` sends JSON through `globalThis.__radon_binding`
- `__radon_dispatch` routes inbound messages back into the agent
- `__radon_agent` is exposed globally

This lines up with a `ConnectSession` flow in the extension bundle.

## Native Helper Binaries

### macOS simulator helper

`dist/simulator-server-macos` is a native universal macOS executable.

Top-level CLI strings indicate commands such as:

- `ios`
- `android`
- `android_device`
- `fingerprint`
- `verify_token`

The binary looks like a controller/service process, not a simple wrapper.

Observed capabilities from strings and linked frameworks:

- video streaming
- screenshots
- clipboard copy
- touch / wheel / key / button injection
- orientation and device-state changes
- Android emulator gRPC control
- Android physical-device agent management via `adb`
- iOS simulator bridge setup
- token verification

Linked frameworks include AppKit, CoreVideo, VideoToolbox, IOSurface, and CoreMedia.

### Android screen-sharing agent

Under `dist/resources/android/`, the package ships screen-sharing artifacts including `screen-sharing-agent.jar` and native `.so` libraries.

The included Android README points upstream to Android Studio screen-sharing resources. This suggests Radon reuses upstream Android screen-sharing infrastructure rather than inventing the whole Android streaming layer from scratch.

Native symbols from `libscreen-sharing-agent.so` indicate JNI-heavy code for:

- clipboard management
- display management
- device state management
- display listeners
- physical display tokens / IDs

## Working Theory

Radon is composed of a few clear layers:

1. a VS Code extension orchestration layer
2. a Metro/Babel injection layer
3. an in-app runtime/bridge layer
4. a webview UI and devtools hosting layer
5. native helper binaries for device/simulator control and streaming

The JS side is currently the easiest and highest-signal reverse-engineering target. The native binaries are a later-stage target if behavior cannot be explained from the JS/runtime layers alone.

## Recommended Next RE Targets

Best next steps:

1. map `panel.js` RPC methods to extension `Project` methods end-to-end
2. correlate extension device-controller calls with `simulator-server-macos` runtime strings / protocol behavior
3. unpack the Android dex layer around the JNI entrypoints
4. compare the shipped build against the public source repo and identify what is missing or changed

## Panel RPC Map

I traced the main webview bridge between `dist/panel.js` and `dist/extension.js` far enough to map the transport and the primary callable objects.

### Bridge transport shape

In `dist/panel.js`, the function `Ga("Project")` builds a generic proxy object that sends:

- `command: "call"`
- `callId`
- `object`
- `method`
- `args`

and then waits for:

- `command: "callResult"`
- matching `callId`

It also supports callback marshalling:

- JS functions are replaced with `__callbackId`
- the extension later posts `command: "callback"` back into the panel
- the extension also posts `command: "cleanupCallback"` when callback refs are released

The panel bootstrap uses this immediately:

- `rn = Ga("Project")`
- `rn.getProjectState()`
- `rn.addListener("projectStateChanged", listener)`
- `rn.removeListener("projectStateChanged", listener)`
- `rn.log(...)`

So there are two separate state/update paths:

1. direct `Project` event emitter traffic for `projectStateChanged`
2. a broader IDE state channel handled separately by the webview controller using:
   - `RNIDE_get_state`
   - `RNIDE_get_state_result`
   - `RNIDE_update_state`
   - `RNIDE_state_updated`

On the extension side, this bridge is implemented by `WebviewController` in `dist/extension.js` around the `476508` region.

### Callable objects exposed to the panel

From `WebviewController.callableObjectGetters`, the webview can remotely call:

1. `Project`
2. `AppRootConfig`
3. `RenderOutlines`

That registry is defined in `dist/extension.js` around the `476527` to `476533` region.

### Project bootstrap flow

The main panel provider does:

1. `Project.getProjectState()`
2. subscribes with `Project.addListener("projectStateChanged", ...)`
3. unsubscribes with `Project.removeListener(...)`
4. forwards browser console/errors with `Project.log(...)`

This is the cleanest proof that the bottom-bar launch/device state is not coming from a hidden store only. The panel explicitly asks `Project` for initial state, then keeps a narrow event subscription just for `projectState`.

### Project methods confirmed as referenced by `panel.js`

The following method names are present in `dist/panel.js` and match methods on the `Project` class in `dist/extension.js`.

#### Bootstrap / project state

- `getProjectState`
- `addListener`
- `removeListener`
- `log`

#### Device selection / sessions / connect

- `startOrActivateSessionForDevice`
- `terminateSession`
- `enableRadonConnect`
- `reloadCurrentSession`

#### Launch configuration UI

- `selectLaunchConfiguration`
- `createOrUpdateLaunchConfiguration`
- `openLaunchConfigurationFile`

#### Tools / profiling / capture

- `updateToolEnabledState`
- `openTool`
- `startProfilingCPU`
- `stopProfilingCPU`
- `startProfilingReact`
- `stopProfilingReact`
- `stopReportingFrameRate`
- `toggleRecording`
- `captureReplay`
- `captureScreenshot`
- `focusDebugConsole`

#### Inspector / navigation to source / AI handoff

- `inspectElementAt`
- `openFileAt`
- `addToChatContext`
- `showDismissableError`
- `sendTelemetry`

#### Device management

- `loadInstalledImages`
- `createIOSDevice`
- `createAndroidDevice`
- `renameDevice`
- `removeDevice`

#### Diagnostics / feedback / editor integration

- `runDependencyChecks`
- `buildDiagnosticsReport`
- `getCommandsCurrentKeyBinding`
- `movePanelTo`
- `openExternalUrl`
- `reportIssue`
- `sendFeedback`
- `saveMultimedia`

#### Device input / deep links / permissions / debugger controls

- `dispatchTouches`
- `dispatchKeyPress`
- `dispatchButton`
- `dispatchWheel`
- `dispatchPaste`
- `dispatchCopy`
- `dispatchHomeButtonPress`
- `dispatchAppSwitchButtonPress`
- `sendBiometricAuthorization`
- `getDeepLinksHistory`
- `openDeepLink`
- `resetAppPermissions`
- `resumeDebugger`
- `stepOverDebugger`
- `stepOutDebugger`
- `stepIntoDebugger`
- `rotateDevices`

### Practical read of that surface

This confirms that the main panel is not just a passive view over extension-owned state. It is an active RPC client into the `Project` object and drives most user actions by directly calling `Project` methods.

That means the main reverse-engineering seam for behavior is:

1. identify the UI action in `panel.js`
2. map it to a `Project` method
3. follow the `Project` method into:
   - `DeviceSessionsManager`
   - `ApplicationSession`
   - `ApplicationContext`
   - device manager / editor bindings / plugin bridge

### AppRootConfig controller path

`panel.js` also creates a separate proxy:

- `Ll = Ga("AppRootConfig")`

This is used by the launch configuration modal/helper code to call:

- `getAvailableEasProfiles(appRoot)`
- `getAvailableXcodeSchemes(appRoot)`

On the extension side, `AppRootConfigController` lives in `dist/extension.js` around the `453413` region and currently exposes:

- `getAvailableApplicationRoots()`
- `getAvailableXcodeSchemes(appRoot)`
- `getAvailableEasProfiles(appRoot)`

The IDE constructor also calls `project.appRootConfigController.getAvailableApplicationRoots()` and pushes that into the main state tree. So:

- application roots are state-fed into the panel
- EAS profiles and Xcode schemes are on-demand RPC lookups from the launch config editor

### RenderOutlines bridge

`RenderOutlines` is exposed as a third callable object:

- it resolves to `project.deviceSession.getPlugin("render-outlines")`

On the extension side, `RenderOutlinesPlugin` is defined around the `469508` region in `dist/extension.js`.

Important observations:

- plugin ID is `render-outlines`
- it listens to inspector bridge events
- when it receives `pluginMessage` with:
  - `pluginId === "render-outlines"`
  - `type === "rendersReported"`
  it re-emits `rendersReported`
- availability is tied to element inspector availability plus an experimental edge-to-edge override

So the render outlines path is not a standalone native feature. It is another bridge-layer plugin hanging off the same runtime/inspector transport.

### What this means for further RE

This panel pass materially narrows the search space.

The most important next step is no longer “figure out what panel.js talks to” in the abstract. That is now clear:

- transport: generic `call` / `callResult`
- bootstrap target: `Project`
- auxiliary targets: `AppRootConfig`, `RenderOutlines`

The next useful move is to take the highest-value `Project` methods and trace them one by one, especially:

1. `startOrActivateSessionForDevice`
2. `selectLaunchConfiguration`
3. `inspectElementAt`
4. `dispatchTouches`
5. `updateToolEnabledState` / `openTool`
6. `captureScreenshot`
7. `reloadCurrentSession`

Those should give the cleanest end-to-end understanding of:

- session lifecycle
- launch/build behavior
- runtime bridge behavior
- input/control protocol
- tool/plugin wiring
- multimedia capture flow

## Session Launch Call Chain

I also traced the main “start app on device” path from the panel into the extension internals.

### Top-level call chain

The main launch path is:

1. `panel.js`
2. `Project.startOrActivateSessionForDevice(deviceInfo)`
3. `DeviceSessionsManager.startOrActivateSessionForDevice(deviceInfo)`
4. `new DeviceSession(...).start()`

So the panel is not launching devices through a hidden command bus. It is directly invoking the `Project` object, and `Project` is just a thin delegating layer here.

### Project layer

In `dist/extension.js`, `Project.startOrActivateSessionForDevice(deviceInfo)` is only a delegation method:

- it forwards directly to `this.deviceSessionsManager.startOrActivateSessionForDevice(deviceInfo)`

That confirms the real session lifecycle logic lives in `DeviceSessionsManager`, not in `Project`.

### DeviceSessionsManager boot policy

`DeviceSessionsManager` contains the automatic “start something on panel open” logic.

Important behavior from `findInitialDeviceAndStartSession()`:

- respects `workspaceConfiguration.deviceControl.startDeviceOnLaunch`
- does nothing if Radon Connect is enabled
- avoids re-entry with `this.findingDevice`
- chooses initial device from:
  - last selected device in workspace state if available
  - otherwise first iOS device
  - otherwise first device overall
- explicitly avoids auto-starting a physical Android device
- calls `startOrActivateSessionForDevice(initialDevice)`
- always calls `onInitialized()` in `finally`

This explains why the panel often boots directly into a simulator/emulator preview without a separate explicit user action.

### DeviceSessionsManager.startOrActivateSessionForDevice

This is the real launch orchestrator.

Observed behavior:

1. waits for PATH/runtime environment setup with `waitForPathEnvSetup()`
2. disables Radon Connect
3. if a session already exists for that device:
   - selects it
   - enforces device/session limits
   - returns
4. otherwise:
   - acquires a concrete device instance from `deviceManager.acquireDevice(...)`
   - initializes per-device state if needed
   - constructs a new `DeviceSession`
   - stores it in the session map
   - updates selected session
   - warns if too many devices are running
   - enforces session/device limits
   - finally runs `await newDeviceSession.start()`

The `DeviceSession` constructor receives:

- per-device derived state
- `ApplicationContext`
- acquired device object
- devtools server
- current rotation
- output channel registry
- Metro provider
- devices state manager

That constructor argument list is a good clue about the subsystem boundaries:

- `ApplicationContext` owns launch/build/debug context
- device object owns actual simulator/emulator/device control
- Metro/devtools are passed in as infrastructure dependencies
- state managers remain external rather than hidden inside the device

### Session selection and persistence

`updateSelectedSession(session)` in `DeviceSessionsManager` does more than just flip a pointer:

- writes the active device ID into workspace state as `LAST_SELECTED_DEVICE_KEY`
- updates project state with `selectedDeviceSessionId`
- deactivates the previous session
- if the previous session's device is now disconnected, it terminates it instead
- activates the newly selected session

So “selected device” is persisted and restored across panel/extension lifecycle, which matches the earlier observed auto-start behavior.

### Session limits

`DeviceSessionsManager.deviceLimits` derives limits from:

- `deviceControl.stopPreviousDevices`
- whether launch config uses a shared Metro port
- whether it uses old devtools

Implications:

- some configurations force total device limit `1`
- Android emulator concurrency is further constrained when sharing Metro
- the manager actively terminates sessions over the computed limit

So multi-device behavior is policy-driven, not just best effort.

## DeviceSession And ApplicationSession Boundary

The next important seam is where high-level panel actions stop being “session management” and start becoming device/runtime control.

### DeviceSession responsibilities

From the traced methods, `DeviceSession` is the main bridge between:

- application/runtime-aware operations
- low-level device preview/input/capture operations

Observed `DeviceSession` behavior:

- recording / replay / screenshot methods forward into `screenCapture`
- touch/key/button/wheel/clipboard methods forward into `device`
- deep links and permission resets depend on the built app context
- `inspectElementAt(...)` delegates into `ApplicationSession.inspectElementAt(...)`

This is a strong boundary:

- pure device I/O goes through `device`
- media capture goes through `screenCapture`
- runtime/app-aware inspection goes through `ApplicationSession`

### Input path

The input path from the panel is therefore:

1. panel calls `Project.dispatchTouches` / `dispatchKeyPress` / `dispatchButton` / `dispatchWheel`
2. `Project` forwards to current `deviceSession`
3. `DeviceSession` forwards to `device.sendTouches` / `sendKey` / `sendButton` / `sendWheel`

Clipboard flow is similar:

1. panel calls `dispatchPaste` / `dispatchCopy`
2. `Project` calls `deviceSession.sendClipboard()` / `getClipboard()`
3. `DeviceSession` forwards to the underlying `device`

So the input/control path is relatively direct once a session exists.

### Capture path

Capture flow is split:

- `Project.captureScreenshot()` -> `DeviceSession.captureScreenshot()` -> `screenCapture.captureScreenshot()`
- if screenshot was saved, the device copies the last screenshot to the clipboard using the current rotation
- `Project.captureReplay()` -> `DeviceSession.captureReplay()` -> `screenCapture.captureReplay()`
- `Project.toggleRecording()` -> `DeviceSession.toggleRecording()` -> recording timer / capture logic

This means capture behavior is not handled by the raw device object alone; there is a higher-level `screenCapture` subsystem managing timers, replay buffers, saving, and clipboard side effects.

### Inspector path

The inspector path is more runtime-aware.

`ApplicationSession.inspectElementAt(xRatio, yRatio, requestStack)`:

1. increments an internal inspect request ID
2. subscribes to inspector bridge `inspectData`
3. sends inspect request through `inspectorBridge.sendInspectRequest(...)`
4. waits for matching response ID
5. if stack frames are remote/http-backed and a debug session exists:
   - tries to map them back through `debugSession.findOriginalPosition(...)`
6. returns resolved inspect payload

This is important because it proves the element inspector is not just a screen-coordinate picker. It is tightly tied to:

- runtime bridge traffic
- response correlation IDs
- debugger-assisted source remapping

That makes `inspectElementAt` one of the best places to study the JS/runtime/debugger intersection.

## Runtime Bridge Protocol

At this point the important finding is that Radon's runtime bridge is not just "using React DevTools somewhere." It is explicitly layering its own reliable message protocol on top of the React DevTools bridge and then using that as the main app-to-extension control plane.

### App-side agent bootstrap

`lib/react_devtools_agent.js` is the lowest readable layer of the bridge.

Observed behavior:

- keeps an internal `devtoolsAgent` reference
- exposes a global `__radon_agent`
- if a React DevTools agent already exists on `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`, it binds immediately
- otherwise it waits for the `react-devtools` hook event
- outbound messages are sent with:
  - `devtoolsAgent._bridge.send("RNIDE_message", message)`
- inbound IDE messages are received with:
  - `bridge.addListener("RNIDE_message", onIdeMessage)`
- outbound messages are queued until a devtools agent becomes available

This matters because it shows Radon is deliberately parasitizing a transport that React Native apps often already expose in dev mode, rather than introducing an independent in-app websocket transport for this layer.

### Reliability layer on top of React DevTools

`lib/inspector_bridge.js` adds a reliability protocol on top of that raw `RNIDE_message` channel.

Observed behavior:

- every outbound message gets an incrementing numeric `id`
- outbound messages are appended to `unacknowledgedMessages`
- app-side listeners receive all non-control messages
- control message `ack` clears acknowledged messages from the queue
- control message `retransmit` resends any queued message newer than the reported last-received id

That means the app-side bridge is not fire-and-forget. It assumes disconnects, reconnects, or bridge loss can happen and explicitly tries to recover.

### Extension-side mirror of the same protocol

The extension-side `DevtoolsInspectorBridge` in `dist/extension.js` mirrors that logic closely enough to treat it as a symmetric protocol, not a one-sided hack.

Observed behavior:

- tracks `lastMessageId`
- when an app message arrives:
  - stores `message.id`
  - immediately sends `{ type: "ack", id: message.id }`
  - emits `message.type` with `message.data`
- when a new devtools connection is attached:
  - sends `{ type: "retransmit", id: this.lastMessageId }`
  - flushes queued extension-to-app messages
- if there is no current devtools connection:
  - extension-side messages are queued instead of dropped

This is one of the more important RE findings so far. Radon has effectively built a small reliable RPC/event lane on top of React DevTools transport. That helps explain why many IDE actions survive debugger reconnects and why the extension can afford to make app state changes through the same bridge as inspector and plugin traffic.

### RN 0.76-specific wakeup hack

There is also a targeted workaround in `lib/inspector_bridge.js` for React Native `0.76`.

The comment explains:

- promises created by debugger-side `Runtime.evaluate` may not resolve until the app "wakes up"
- Radon forces a zero-delay timeout as a wakeup mechanism

This is useful as reverse-engineering evidence because it shows Radon is compensating for concrete runtime/debugger bugs in specific RN versions, not just wrapping a stable abstract API.

### Practical protocol read

At a protocol level, the bridge now looks like this:

1. React DevTools bridge carries raw `RNIDE_message`
2. Radon adds `id`, `ack`, and `retransmit`
3. higher-level message types ride on top of that:
   - `inspect`
   - `inspectData`
   - `openPreview`
   - `navigationChanged`
   - `pluginMessage`
   - `appReady`
   - `devtoolPluginsChanged`
   - and others

So the "inspector bridge" is not just for element inspection. It is the main application control and telemetry lane once the runtime is injected.

## Runtime Bootstrap And Wrapper Semantics

Reverse-engineering `lib/runtime.js` and `lib/wrapper.js` gives a clearer picture of what Radon is actually doing inside the running app.

### Runtime bootstrap is invasive but intentionally narrow

`lib/runtime.js` does not try to replace the whole app bootstrap. Instead it inserts itself at a few high-leverage points:

- logs `__RNIDE_INTERNAL`, `radon-ide runtime loaded`
- wraps `console.log`, `console.warn`, `console.error`, and `console.info`
- sets `global.__RNIDE_enabled = true`
- exposes:
  - `global.__RNIDE_register_navigation_plugin`
  - `global.__RNIDE_register_dev_plugin`
- installs Radon's wrapper through `AppRegistry.setWrapperComponentProvider`
- monkey-patches `AppRegistry.setWrapperComponentProvider` so app-defined custom wrappers are nested rather than replacing Radon's wrapper
- eagerly loads `./plugins/redux-devtools`

The most interesting detail is the console wrapping.

### Console wrapping is source-link preservation, not just log interception

The console wrapper does not merely forward logs to the extension. It computes a stack offset so the appended file/line/column point at the real caller rather than Radon's wrapper or some third-party wrapper such as Sentry.

Observed behavior:

- parses `new Error().stack` via RN internals
- detects re-entry to compare wrapper vs caller stacks
- calculates the first divergent frame
- appends `file`, `lineNumber`, and `column` to the original console call

This is important because it explains how Radon makes logs navigable in the IDE without requiring a fully separate logging pipeline.

### The wrapper is a real control surface

`lib/wrapper.js` is not cosmetic. It is effectively the runtime-side command interpreter and event producer.

Inbound command handling observed in the wrapper:

- `openPreview`
- `openUrl`
- `openNavigation`
- `inspect`
- `showStorybookStory`

Outbound event traffic observed from the wrapper:

- `appReady`
- `navigationChanged`
- `navigationRouteListUpdated`
- `inspectData`
- `fastRefreshStarted`
- `fastRefreshComplete`
- `devtoolPluginsChanged`

That means the wrapper is the runtime object that translates IDE intent into app actions and app state changes back into IDE-facing events.

### Preview mode is runtime app substitution

The preview behavior is more invasive than a simple navigation hack.

Observed `openPreview` behavior:

- looks up the preview in `global.__RNIDE_previews`
- computes a preview URL prefix such as `preview:` or `sb:`
- calls `AppRegistry.runApplication(InternalImports.PREVIEW_APP_KEY, ...)`
- injects `__radon_previewKey` and a synthetic navigation descriptor

Observed `openMainApp` behavior:

- can reopen the main app through `AppRegistry.runApplication(mainAppKey, ...)`
- can force a remount by briefly running `__radon_dummy_component` first
- uses `__radon_onLayout` to know when the main app has reopened

This is a stronger RE result than "Radon supports previews." Radon is actively swapping which registered RN application is running in the root tag and using synthetic navigation metadata to keep the IDE in sync.

### Inspector data extraction is multi-strategy

`getInspectorDataForCoordinates(...)` in the wrapper is more sophisticated than a simple `getInspectorDataForViewAtPoint` passthrough.

Observed strategy:

1. ask RN internals for the view at screen coordinates
2. always compute a normalized frame in screen-relative coordinates
3. if no stack was requested:
   - return only the frame
4. if a stack was requested:
   - try to walk the fiber tree via renderer config
   - use `getInspectorDataForInstance` when available
   - if present, prefer `_debugStack.stack` to infer the render-site source frame
   - fall back to `viewData.hierarchy` if the modern renderer path is unavailable
   - measure each component instance if possible
   - return a stack of component/source/frame objects

So element inspection is not merely visual hit-testing. Radon is reconstructing a component stack and augmenting it with source locations and per-component frames where possible.

### Wrapper also normalizes app behavior for the IDE

Other meaningful runtime behaviors in the wrapper:

- overrides `LoadingView.showMessage` / `hide` to emit fast-refresh lifecycle events
- initializes render outlines, network plugin, orientation listeners, and inspector availability listeners
- installs a wrapped global error handler that clears `LogBoxData` before delegating
- suppresses noisy logs with `LogBox.ignoreAllLogs(true)`
- uses wrapper `onLayout` to emit dimensions, including platform-specific handling for Android vs iPad quirks

This makes the wrapper closer to a runtime host environment than a simple HOC. It actively reshapes app/devtool behavior so the IDE can treat the running app as a controllable target.

## Tool And Plugin System

The tool layer is more dynamic than it first appears. Radon does not assume every tool exists just because the extension ships UI for it.

### Runtime plugin multiplexing

`lib/plugins/PluginMessageBridge.js` shows the common app-side plugin transport:

- every plugin is identified by a `pluginId`
- all plugin traffic is wrapped in inspector-bridge messages of type `pluginMessage`
- inside that envelope, Radon multiplexes:
  - `pluginId`
  - plugin-local `type`
  - plugin-local `data`

This means the runtime bridge is a shared bus, not a separate transport per devtool.

### Extension-side plugin activation model

`ToolsManager` in `dist/extension.js` makes an important distinction between:

- plugin code known to the extension
- plugin actually installed/available in the app runtime
- plugin currently enabled by user preference
- plugin currently active for the selected session

Observed behavior:

- the extension pre-registers plugin classes for:
  - Expo dev plugins
  - React Query
  - Redux
  - Apollo Client
  - Network
  - Render Outlines
- app runtime sends `devtoolPluginsChanged`
- payload is a list of currently registered runtime plugins
- only then does `ToolsManager` mark a plugin as `toolInstalled`
- `toolsSettings` determines whether installed plugins should be enabled
- `activePlugins` tracks currently enabled+bound plugins

This is a stronger result than "there are plugins." The extension is negotiating tool availability with the runtime at session time.

### Tool availability is runtime-derived

This especially matters for tools like Redux, Apollo, and React Query.

The extension UI is not proof that the app supports those tools. The actual runtime advertises installed dev plugins, and the extension updates visible tool state from that advertisement.

That explains why the UI can remain generic while behavior stays app-specific.

### Render outlines is a plugin, not a special case

The render outlines path is especially revealing:

- runtime emits `pluginMessage`
- extension-side `RenderOutlinesPlugin` listens for:
  - `pluginId === "render-outlines"`
  - `type === "rendersReported"`
- the plugin then exposes that as a regular event stream

So even a feature that feels tightly coupled to rendering diagnostics is still built as another plugin riding the general bridge.

## Network Inspection Reverse Engineering

The network tool deserves a deeper note because it is one of the clearest examples of Radon building a protocol adapter rather than just embedding someone else's UI.

### Network plugin is a CDP adapter over RN interceptors

`lib/network/network.js` does three things:

1. creates a plugin bridge with `pluginId = "network"`
2. intercepts RN XHR and fetch traffic
3. emits Chrome DevTools Protocol-like messages back to the extension

That is the key architectural point: Radon is translating RN network activity into something CDP-like enough for IDE tooling to consume.

### Startup and control semantics

Observed startup/control behavior:

- initialization is guarded by `setupCompleted`
- on setup, the plugin immediately sends:
  - `IDE.clearStoredMessages`
- it listens for plugin messages of type `cdp-message`
- `Network.enable` activates interception
- `Network.disable` disables interception and clears buffers
- it also honors IDE control messages:
  - `IDE.stopNetworkTracking`
  - `IDE.startNetworkTracking`

This shows the network layer is not just passive event forwarding. The IDE can tell the runtime when to track and when to stop buffering.

### Response body handling

Response bodies are not sent inline with every network event.

Observed behavior:

- response bodies are stored in an `AsyncBoundedResponseBuffer`
- `Network.getResponseBody` fetches from that buffer later
- the response is returned as an IDE-side message:
  - `IDE.ResponseBodyData`

So Radon is implementing a buffered request/response model close to how DevTools-style tooling expects to retrieve response bodies on demand.

### Event model

Observed emitted CDP-like events include:

- `Network.requestWillBeSent`
- `Network.responseReceived`
- `Network.dataReceived`
- `Network.loadingFinished`
- `Network.loadingFailed`

The plugin also tracks:

- request ids
- content type and derived resource type
- ttfb
- encoded length
- request postData

This is one of the clearest places where Radon is doing substantial product work rather than just exposing an upstream UI.

## Launch And Build Heuristics

Reverse-engineering the extension-side build path makes it clear that Radon is not a single launcher. It is a decision engine that classifies the app and then selects a build/runtime strategy.

### Build type inference

`inferBuildType(platform, launchConfiguration)` selects among:

- `custom`
- `eas`
- `easLocal`
- `expoGo`
- `devClient`
- `local`

Observed decision order:

1. if both custom and EAS configs exist:
   - throw an error
2. custom build command wins if present
3. EAS wins if configured
4. if `usePrebuild` is false and the project is Expo Go-compatible:
   - choose `expoGo`
5. else if the project looks like a dev client project:
   - choose `devClient`
6. otherwise:
   - choose local native build

This is significant because it means Radon is not just reading an explicit build mode from config. It is inferring a strategy from project structure and launch config.

### Build config materialization

`createBuildConfig(...)` then expands that chosen strategy into a normalized build config.

Examples of what gets materialized:

- iOS runtime identifier
- iOS scheme / configuration
- Android product flavor / build type
- `usePrebuild`
- target architecture
- EAS profile/config
- custom build command
- fingerprint command

So there is a normalization step between user config/project detection and the actual builders. That is why later stages can treat build types more uniformly.

### Expo CLI decision is heuristic, not explicit-only

`shouldUseExpoCLI(launchConfig)` returns true not only when `isExpo` is set, but also when the project looks Expo-like enough.

Observed checks:

- explicit `launchConfig.isExpo`
- reject if a custom Metro config path is set
- resolve local `expo` and `@expo/cli`
- inspect `app.json`
- inspect `app.config.js`
- inspect `package.json` scripts for `expo `

So Radon tries to infer whether Expo CLI is the right bundler path even when the config is not fully explicit.

### Package manager resolution is also heuristic

Package manager choice is not hardcoded.

Observed order:

1. explicit launch config `packageManager`
2. `package.json.packageManager`
3. newest matching lockfile in workspace
4. fallback to `npm`

Supported managers:

- `npm`
- `yarn`
- `pnpm`
- `bun`

This matters because it shows Radon is trying to enter an existing workspace ecosystem rather than forcing one package-manager assumption.

### Dependency preparation is part of the launcher

`ApplicationDependencyManager` is another important part of the real launch path.

Observed start/build preparation behavior:

- `ensureDependenciesForStart(...)`
  - checks package manager installation
  - installs `node_modules` if missing
  - checks Node version against app and RN minimums
- `ensureDependenciesForBuild(...)`
  - runs prebuild if required
  - verifies native directories
  - installs Pods for iOS local/dev-client builds when needed

So the launcher is not just "run Metro then build." It includes dependency repair and project-shape normalization.

### Metro launch is heavily instrumented

The Metro path is one of the most important RE targets because it ties the extension, injected runtime, and debugger together.

Observed injected Metro env/config behavior:

- sets:
  - `RADON_IDE_LIB_PATH`
  - `RADON_IDE_VERSION`
  - `RCT_METRO_PORT`
  - optional `RCT_DEVTOOLS_PORT`
  - `REACT_EDITOR`
  - `EXPO_EDITOR`
  - `DEBUG=expo:utils:editor`
- uses either:
  - `UniqueMetroProvider`
  - `SharedMetroProvider`
- shared Metro is ref-counted and keyed off configured Metro port reuse
- `lib/metro_helpers.js`:
  - injects `__REACT_DEVTOOLS_PORT__` into Metro prelude
  - records Expo env prelude line counts
  - adds extension `lib` as a watch folder
  - exposes `__RNIDE_lib__`, `__REACT_NATIVE_INTERNALS__`, and `__APPDIR__`
  - rewrites `babelTransformerPath` to Radon's transformer
  - emits watch-folder metadata back to the extension
  - versions Metro cache with Radon version

This is not a small convenience wrapper around Metro. Radon is controlling module resolution, prelude contents, source-map correctness, stack-frame editor integration, and transformer injection from this layer.

## Launch Configuration Reverse Engineering

The launch-configuration path is more interesting than it first appears. Radon is not just storing a dropdown selection in panel state. It has a split model with:

1. detected application roots that do not have to exist in `launch.json`
2. custom persisted launch configurations stored in workspace `launch.configurations`
3. a separately persisted "initial/selected" launch config snapshot in workspace state

That split explains a lot of Radon's behavior around startup, stale configs, and why selecting a config feels like switching projects rather than just flipping a small flag.

### Two classes of launch configuration

The panel dropdown combines two different kinds of entries:

- `Detected`
- `Custom`

This distinction is explicit in the runtime objects passed around the extension and panel.

#### Detected configs

Detected configs are built on the fly from `applicationRoots`.

The panel-side selector constructs them like:

- `{ appRoot, name, kind: "Detected", env: {} }`

These entries are derived from application-root discovery, not from `launch.json`.

On the extension side, available application roots are gathered by:

- scanning workspace folders for likely app roots
- merging those with custom application roots from workspace state
- reading display metadata from `app.json`, `app.config.json`, or `package.json`

So a detected config is really "a discovered app root wrapped in the same shape as a launch config."

#### Custom configs

Custom configs come from workspace debug configurations.

`getLaunchConfigurations()` filters `workspace.getConfiguration("launch").configurations` to only:

- `type === "radon-ide"`
- `type === "react-native-ide"`

Then `LaunchConfigurationsManager` normalizes those into internal launch-config objects with:

- `kind: "Custom"`
- default `appRoot` if missing and discoverable
- default `env: {}`

This means the internal launch-config shape is broader than the raw `launch.json` representation. Radon derives missing defaults before using a config.

### Default app-root inference is part of config normalization

If a launch config does not explicitly include `appRoot`, Radon tries to infer one.

Observed behavior in `findDefaultAppRoot(...)`:

- scans for candidate app roots
- returns the first candidate relative to workspace root
- if there are multiple candidates and warnings are enabled:
  - shows a warning
  - offers `Add Launch Configuration`

That makes app-root inference part of the launch-config layer itself, not just a precondition elsewhere in startup.

### What gets persisted to `launch.json`

When Radon serializes a custom launch configuration back to disk, it does not persist the full internal object.

`serializeLaunchConfiguration(...)` writes:

- `name: "Radon IDE panel"` unless overridden by options
- `type: "radon-ide"`
- `request: "launch"`
- only keys from `LAUNCH_OPTIONS_KEYS`

Important consequence:

- `kind` is not persisted
- only supported launch options survive serialization
- legacy `react-native-ide` entries are read, but newly serialized entries are written as `radon-ide`

So Radon treats `launch.json` as a compatibility/persistence format, not the canonical in-memory model.

### Panel form logic is schema-backed

The panel's launch-config modal is not built from arbitrary hardcoded field names alone.

Observed behavior in `panel.js`:

- the bundle contains an embedded debug configuration schema object for `radon-ide`
- `oS()` resolves the `configurationAttributes.launch` schema from that embedded object
- the modal passes that schema down to build-setting sections

This matters because the panel is effectively carrying a mirrored version of the extension's debug-config contract. The UI is not just collecting free-form fields; it is being driven by the same conceptual schema as the debug configuration type.

### Save path from panel to workspace config

The save path is concrete and fairly clean.

Observed panel behavior in `function fo(...)`:

1. modal form is backed by a real `<form>`
2. submit handler builds `new FormData(form)`
3. `lS(formData, defaultAppRoot)` converts raw form fields into a normalized internal launch-config object
4. `cS(formData)` computes `fieldsToRemove`
5. panel calls:
   - `project.createOrUpdateLaunchConfiguration(newConfig, oldConfig, fieldsToRemove)`
6. modal closes

That is more than a basic form submit. Radon computes both:

- the new desired config
- an explicit list of stale keys that should be removed from the old persisted config

### Form-to-config reconstruction logic

The panel-side reconstruction function `lS(...)` is worth noting because it reveals the intended configuration model.

Observed behavior:

- empty strings are normalized to `undefined`
- boolean select values `"true"` / `"false"` are converted back to booleans
- `env` is stored as JSON in a hidden input and parsed back into an object
- `buildType.ios` / `buildType.android` decide whether the resulting config emits:
  - standard native config under `ios` / `android`
  - `customBuild`
  - `eas`
  - `eas.local`

So the modal is not editing the raw persisted shape directly. It is editing a higher-level form model and then lowering it back into a launch-config object.

### Radon explicitly prunes stale config sections

`cS(formData)` computes fields that should be removed from the persisted config when the user changes build strategy or clears optional fields.

Observed pruning behavior:

- if neither platform uses EAS:
  - remove `eas`
- if neither platform uses custom build:
  - remove `customBuild`
- if iOS no longer uses standard build settings:
  - remove `ios`
- if Android no longer uses standard build settings:
  - remove `android`
- also removes some blank top-level option fields such as:
  - `name`
  - `metroConfigPath`
  - `usePrebuild`
  - `useNativeNetworkInspector`

This is an important RE point. Radon is trying to keep `launch.json` semantically clean when the user switches build modes, rather than only layering new fields on top of old ones.

### Delete path

The delete path is also explicit in the panel bundle.

Observed behavior:

- delete button opens a confirmation modal
- confirm action calls:
  - `project.createOrUpdateLaunchConfiguration(void 0, oldConfig, [])`
- modal closes

So deletion is implemented through the same create/update path, with `newLaunchConfiguration === undefined`.

### "Edit in launch.json" is an editor command, not a custom file writer

The panel exposes an `Edit in launch.json` action, but Radon does not open a specific file path itself.

Observed behavior:

- panel calls `project.openLaunchConfigurationFile()`
- `Project.openLaunchConfigurationFile()` delegates to editor bindings
- editor bindings run:
  - `workbench.action.debug.configure`

This is a useful detail: Radon lets the host editor own `launch.json` file creation/opening behavior rather than implementing its own file path logic.

### How the extension mutates workspace launch configs

`LaunchConfigurationsManager.createOrUpdateLaunchConfiguration(...)` is the actual persistence layer.

Observed behavior:

1. read `workspace.getConfiguration("launch")`
2. get `configurations` array
3. if `oldLaunchConfiguration` was provided:
   - find matching config by deep equality after normalizing stored config through `launchConfigFromOptionsWithDefaultAppRoot(...)`
4. if found and `newConfig` is undefined:
   - remove the entry
5. if found and `newConfig` exists:
   - merge old raw config with new launch-config object
   - omit any keys in `fieldsToRemove`
   - replace the existing entry
6. if not found and `newConfig` exists:
   - append a new entry
7. write the updated array back with:
   - `launchConfig.update("configurations", configurations)`

Important implications:

- unrelated non-Radon debug configs are preserved
- legacy and new Radon config types are both recognized for matching
- matching is done against normalized full configs, not only by name
- update semantics are patch-like, not replace-whole-file

### Selected launch config is separately persisted in workspace state

Radon does not rely on `launch.json` alone to remember the active selection.

It stores the currently selected launch config under:

- `INITIAL_LAUNCH_CONFIGURATION_KEY = "initialLaunchConfiguration"`

That saved snapshot is used on startup to decide what the panel should consider "current."

Observed restore logic:

- if saved config is `Detected` and its `appRoot` still exists among available application roots:
  - reuse it
- if saved config is `Custom` and an exact deep-equal custom config still exists:
  - reuse it
- otherwise if custom launch configs exist:
  - use the first custom config
- otherwise:
  - synthesize a detected config from default app-root discovery

This is why Radon can remember a detected app root even though detected configs are not persisted into `launch.json`.

### What selecting a launch config actually does

This is the most important behavioral point in the whole launch-config path.

`Project.selectLaunchConfiguration(...)` is not a light state update. It is effectively a runtime context rebuild.

Observed behavior:

1. ignore no-op deep-equal selection
2. set `selectedLaunchConfiguration`
3. call `applicationContext.updateLaunchConfig(launchConfig)`
4. dispose the existing `DeviceSessionsManager`
5. create a brand new `DeviceSessionsManager`
6. maybe auto-start an initial device session again
7. save selected config in workspace state
8. update project state with:
   - `appRootPath`
   - `selectedLaunchConfiguration`

That means a launch-config change is closer to "switch active app/runtime context" than "update a few build flags."

### What `ApplicationContext.updateLaunchConfig(...)` rebuilds

The rebuild continues one level deeper inside `ApplicationContext`.

Observed behavior:

- re-resolves the launch config through `resolveLaunchConfig(...)`
- reruns PATH setup for the new absolute app root
- recomputes React Native version
- updates `ApplicationDependencyManager`
- runs dependency checks
- disposes any old websocket devtools server
- recreates old-devtools server if needed
- disposes the old Metro provider
- recreates the Metro provider for the new config

So changing launch config can alter:

- app root
- environment loading
- RN version assumptions
- dependency-check state
- devtools transport mode
- Metro reuse mode

That is why Radon rebuilds session management on selection rather than trying to mutate the current session in place.

### `resolveLaunchConfig(...)` adds dynamic behavior

The resolved launch config is not just the raw stored object with an absolute path added.

Observed behavior:

- `absoluteAppRoot` is resolved relative to workspace root
- `env` becomes a getter that:
  - merges process env with configured env
  - loads project `.env` files from the selected app root
  - logs when the loaded env-file set changes
- `preview.waitForAppLaunch` defaults to `true`
- `useOldDevtools` defaults based on RN Fusebox support

So the selected launch config is really a lazy runtime configuration object, not merely a deserialized JSON blob.

### Stale config handling is intentional and layered

Radon has two different stale-config detection surfaces.

#### Panel-side stale warning

In the app selector UI:

- if the selected custom config no longer matches any current custom config by deep equality
- the selector value becomes `"unknown"`
- the panel shows an alert saying the selected launch config was deleted or modified in `launch.json`

That is a UX-level warning only.

#### Runtime stale handling on reload

`Project.reloadCurrentSession(...)` performs a stricter stale check for selected custom configs:

- if exact config still exists:
  - continue
- otherwise try to find a replacement with the same:
  - `name`
  - `appRoot`
- if found:
  - auto-select the replacement
- otherwise:
  - show an error
  - throw `"Selected launch configuration is stale"`

This is a stronger reverse-engineering signal than a simple panel warning. Radon expects launch configs to mutate underneath it and has explicit recovery heuristics.

### Debug-session handoff uses the same selection path

There is also an important bridge between the editor's debug system and the panel's selection model.

`LaunchConfigDebugAdapterDescriptorFactory.createDebugAdapterDescriptor(session)`:

- asserts that the debug config is a Radon config
- converts `session.configuration` through `launchConfigurationFromOptions(...)`
- if an IDE instance already exists:
  - calls `existingIDE.project.selectLaunchConfiguration(initialLaunchConfig)`
- otherwise:
  - initializes the IDE with that launch config
- then opens the panel

This means launching a `radon-ide` debug configuration from the editor is not a separate code path. It feeds into the same project-selection and application-context machinery as the panel.

### Practical launch-config read

The best mental model is:

- detected configs are ephemeral app-root selections
- custom configs are normalized views over workspace `launch.json`
- selected config is additionally snapshotted in workspace state
- selecting a config rebuilds app/runtime infrastructure
- saving/deleting configs mutates only the relevant Radon entries in `launch.configurations`
- stale configs are expected and explicitly handled

That is a much richer system than a simple debug-profile dropdown.

## Public Repo Comparison

I compared the shipped `1.16.20260304` package against the public `software-mansion/radon-ide` GitHub repository and the result is important:

- the public repo is not a source mirror of the shipped extension
- it is primarily a docs / issue-tracking repository
- there is no publicly available source tree in that repo that corresponds to the extension implementation we are reversing from the VSIX

This is not an inference from "I couldn't find a file quickly." It is explicit from the repo contents and README.

### Public repo scope is explicitly limited

The public repo README states:

- "This repository is for issue tracking and discussion only."

That statement matches what is actually in the tree.

### `v1.16.0` public tag does not contain extension implementation source

The closest obvious public tag to the shipped build is:

- `v1.16.0`

The shipped package version is:

- `1.16.20260304`

So `v1.16.0` is the natural public baseline to inspect first.

Observed `v1.16.0` tree shape:

- `.github`
- `LICENSE.txt`
- `README.md`
- `packages/docs`

Observed absence:

- no extension package root
- no `dist/extension.js`
- no `dist/panel.js`
- no `lib/runtime.js`
- no `lib/wrapper.js`
- no `lib/babel_transformer.js`
- no launch/session/application source tree corresponding to the VSIX internals

I also checked the git history for representative implementation paths such as:

- `lib/runtime.js`
- `packages/extension/src/project/project.ts`
- `packages/ide/src/project/project.ts`

and got no history hits in the public repo.

So this is not merely "the code moved recently" within the public repository history we have. The public repo, as cloned, does not expose the extension implementation lineage we would need for a real source-to-binary diff.

### `v1.16.0` tag itself is docs-oriented

The `v1.16.0` tag resolves to commit:

- `8b936a5e48ae7cbcdd94d118860b8d678ab5a5ac`

The tagged commit is a docs change:

- `docs: Document radon-mcp (#1906)`

And the diffstat for that tag commit touches documentation/components under `packages/docs`, not extension runtime source.

That is another strong signal that public release tags in this repo are not source releases for the extension implementation.

### Practical consequence for reverse engineering

Because the public repo does not contain the extension implementation, an exact source diff against the shipped VSIX is not currently possible using that repo alone.

That means:

- we cannot map `1.16.20260304` to a public source snapshot for `dist/extension.js`
- we cannot compare `lib/runtime.js`, `lib/wrapper.js`, `lib/network/network.js`, etc. against a public authoritative implementation source in that repo
- for implementation-level RE, the shipped JS bundle remains the primary source of truth

So the reverse-engineering strategy we have been using was not just convenient. Given the public repo structure, it is necessary.

### What the public repo is still useful for

Even though it does not expose implementation source, the public repo is still useful for:

- license text
- product claims and scope
- changelog anchoring
- documentation of supported features and user-facing behavior

In other words:

- useful for validating what the product says it does
- not useful for reconstructing how the extension implementation does it

### Public `1.16.x` changelog vs shipped build

The `packages/docs/docs/_changelog/1.16.x.md` file is dated:

- `2026-03-11`

and highlights:

- network throttling and native network traffic on iOS simulators
- Expo SDK 55 support
- screenshots copied to pasteboard
- AI chats accessing device network logs
- improved Storybook support with custom configuration file path
- Action Button support for iOS simulators

Some of these are directly corroborated by readable code in the shipped build.

#### Corroborated in readable shipped JS

1. **Screenshots copied to clipboard / pasteboard**

   In the shipped extension, `DeviceSession.captureScreenshot()` does:

   - `screenCapture.captureScreenshot()`
   - if saved, `device.copyLastScreenshotToClipboard(rotation)`

   So this changelog claim maps cleanly to implementation.

2. **Native network inspector support**

   The shipped build exposes:

   - launch option `useNativeNetworkInspector`
   - `ApplicationSession.shouldEnableNativeNetworkInspector()`
   - fallback/selection between:
     - `DebuggerNetworkInspector`
     - `InspectorBridgeNetworkInspector`

   The readable logic also shows:

   - automatic enablement only on sufficiently new RN versions
   - explicit disablement on Android in that path

   So the native-network-inspector part of the changelog clearly corresponds to actual shipped logic.

3. **Improved Storybook support with custom config path**

   The shipped build contains:

   - `lib/storybook/storybook_config_reader.js`
   - `RADON_STORYBOOK_CONFIG_PATH`
   - Storybook config path detection and Metro injection
   - runtime-side preview helpers in `lib/wrapper.js`

   So this changelog claim is also strongly corroborated.

4. **AI chats accessing device network logs**

   The shipped build includes MCP / AI tooling code such as:

   - `src/ai/mcp/networkLogProcessing.ts`
   - `ViewNetworkLogsTool`
   - `ViewNetworkLogDetailsTool`

   The readable implementation path includes:

   - a `getNetworkLogs()` helper that fetches the current device session's network plugin
   - redaction of sensitive headers before exposing data

   So this is not just a docs claim either; there is readable implementation support in the package.

#### Only partially corroborated from readable JS

1. **Action Button support for iOS simulators**

   Public docs mention:

   - "Action Button - simulate the press of device action button."

   In the shipped readable JS we can see:

   - a generic `sendButton(button, direction)` path
   - project/device-session forwarding for button events

   But the actual simulator-specific implementation for the iOS Action Button likely sits in the native helper / preview transport layer, which we have intentionally not decompiled yet.

   So for this feature:

   - public docs say it exists
   - readable JS shows the generic control path exists
   - the simulator-specific implementation is not fully visible without going into compiled/native territory

### Net result of the public repo comparison

The public repo gives us three useful categories of information:

1. **Explicit non-source status**
   - README says issue tracking / discussion only

2. **Product-level behavior claims**
   - docs and changelog

3. **No implementation mirror**
   - no readable extension source corresponding to the shipped package internals

So the public repo comparison changes the RE strategy in a concrete way:

- use public docs/changelog to anchor feature intent and release framing
- use the shipped JS package itself for implementation RE
- treat native helpers as the next boundary only when readable JS stops answering the question

## Network Subsystem Reverse Engineering

The network inspector is not a single feature implemented in one place. It is a layered subsystem with a very deliberate abstraction boundary.

At the highest level:

1. the app or debugger produces CDP-like network events
2. the extension normalizes and stores those events
3. both the webview UI and Radon AI / MCP read from the same normalized store

That is a more important RE result than merely naming the classes, because it explains why Radon can swap collection strategies without rewriting the UI or AI tooling.

### The extension normalizes network traffic into a stable internal model

`BaseNetworkInspector` in `dist/extension.js` is the key abstraction.

It does not care whether events came from:

- app-side JS interception
- debugger/native network inspector
- future alternative transport

Instead, it stores raw `WebviewMessage`-style records in `networkMessages`, then reconstructs request state on demand by folding all `cdp-call` messages by `requestId`.

That fold produces the normalized request model:

- `currentState`
- `requestId`
- `request`
- `response`
- `encodedDataLength`
- `type`
- `initiator`
- `timeline`
  - `timestamp`
  - `wallTime`
  - `durationMs`
  - `ttfb`

This means Radon does **not** treat the underlying event stream as the product-facing API. The product-facing API is the reconstructed log entry.

That is a classic sign of a system designed to tolerate multiple backends.

### Metro traffic is intentionally filtered out

`BaseNetworkInspector.isInternalRequest(...)` explicitly filters requests that target:

- `localhost`
- `127.0.0.1`
- `10.0.2.2`

when the port matches the active Metro port.

This matters because it means the network inspector is not intended to be a literal packet log. It is an application-focused diagnostic view that deliberately hides the dev-server noise Radon itself depends on.

That filtering also explains why the inspector can be useful to AI tooling later: the log has already been denoised for human debugging.

### Tracking can be stopped without fully disabling the feature

`BaseNetworkInspector` has a distinction between:

- tracking being enabled or disabled
- the network plugin itself being active or inactive

If tracking is disabled:

- `cdp-call` payloads are no longer persisted or broadcast
- but `ide-call` control messages still go through

This is important because it shows the "pause recording" button is not the same as tearing down the entire tool. The control channel remains alive.

### There are two different response-body retrieval paths

This is one of the more interesting design choices.

From the network webview side, the extension supports:

1. `IDE.getResponseBodyData`
2. `IDE.fetchFullResponseBody`

These are **not** the same thing.

`IDE.getResponseBodyData`:

- asks the underlying collector for the response body of a request that was already captured
- is the "forensic" path
- tries to show what the app actually received during the recorded request

`IDE.fetchFullResponseBody`:

- replays the request using `fetch(request.url, { method, headers, body })`
- reads the response again
- opens it in an editor tab
- is the "convenience" path

This implies a practical design decision:

- the inspector detail view prefers captured evidence
- the "open response" workflow is allowed to trade perfect historical fidelity for usability

That is a meaningful reverse-engineering conclusion, not just an implementation detail.

### App-side JS interception strategy

The app-side network collector starts in `lib/network/network.js`.

`setup()` does three important things immediately:

1. creates `PluginMessageBridge("network")`
2. creates `AsyncBoundedResponseBuffer()`
3. sends `IDE.clearStoredMessages` to the extension

That third step is a subtle but important signal: Radon expects stale extension-side network state to survive across reconnects/reloads unless it explicitly clears it.

When enabled, the JS-side collector uses two interception mechanisms:

- `RNInternals.XHRInterceptor`
- `PolyfillFetchInterceptor`

So the app-side path is not just "patch fetch". It is a hybrid interception layer covering:

- classic XHR
- libraries built on XHR such as axios
- `react-native-fetch-api` polyfill traffic that bypasses XHR

### XHR path behavior

The XHR interception path in `lib/network/network.js` emits:

- `Network.requestWillBeSent`
- `Network.responseReceived`
- `Network.dataReceived`
- `Network.loadingFinished`
- `Network.loadingFailed`

The body is only pushed into `AsyncBoundedResponseBuffer` on `loadend`, after the response is actually available in full.

That tells us the live event stream is optimized for timeline fidelity first, body access second.

### `react-native-fetch-api` support is deeper than a wrapper patch

The `PolyfillFetchInterceptor` is one of the most interesting readable pieces in the package.

The bundled `polyfill_readme.md` and the interceptor source make it clear that Radon is compensating for specific weaknesses of the polyfill lifecycle rather than just adding a broad monkey patch.

It wraps internal methods such as:

- `__didReceiveNetworkResponse`
- `__didReceiveNetworkIncrementalData`
- `__didReceiveNetworkData`
- `__didCompleteNetworkResponse`
- `__abort`

The important design detail is that this exists because `react-native-fetch-api` talks to native `Networking` directly and would otherwise escape the normal XHR interception layer.

So Radon did not merely add support for one more library. It added a second interception strategy because the first one was structurally incapable of seeing those requests.

### Streaming and cancellation handling are first-class concerns

The polyfill interceptor also handles streaming response edge cases that would otherwise leave the inspector in a broken or misleading state.

Specifically, it patches:

- stream reader completion
- stream cancellation paths
- internal `_cancelAlgorithm`
- `getReader()` lifecycle

The point is not academic completeness. It is to guarantee that a streaming request still ends with a terminal network event even when the consumer cancels early or the native callback sequence is incomplete.

That means the inspector is trying to preserve:

- terminal state correctness
- partial-body preservation
- timeline consistency

This is more sophisticated than a best-effort console logger. It is explicitly built to avoid "stuck" requests in the UI.

### Extension-side strategy split: JS bridge vs native debugger

`NetworkPlugin2` chooses between two extension-side collectors:

1. `InspectorBridgeNetworkInspector`
2. `DebuggerNetworkInspector`

That split is controlled by `useNativeNetworkInspector`.

#### `InspectorBridgeNetworkInspector`

This is the JS/runtime path.

It:

- sends `Network.*` requests into the app via `inspectorBridge.sendPluginMessage("network", ...)`
- listens for `pluginMessage` events coming back from the app
- rebroadcasts them to the network webview
- uses `IDE.startNetworkTracking` / `IDE.stopNetworkTracking` to control app-side buffering

This path is always conceptually available as long as the app-side wrapper/plugin bridge is running.

#### `DebuggerNetworkInspector`

This is the debugger/native path.

It:

- uses `NetworkBridge`
- waits for JS debugger availability
- sends custom debug requests like:
  - `RNIDE_enableNetworkInspector`
  - `RNIDE_disableNetworkInspector`
  - `RNIDE_getResponseBody`
- those requests are translated by the proxy debug adapter into real CDP `Network.*` commands

This means the "native network inspector" is not an entirely separate UI. It is a different **collector backend** feeding the same extension-side normalized model.

That is a very strong architectural signal:

- the user-facing tool is collector-agnostic
- the collection source is swappable
- the extension owns the stable product contract

### The debugger/native path also protects the UI from large bodies

`DebuggerNetworkInspector.parseResponseBodyData(...)`:

- decodes base64 when appropriate
- preserves image bodies as base64
- truncates very large bodies

The explicit truncation limit exists to avoid webview freezes.

So the native path is not a raw passthrough from CDP to UI. It is curated and shaped before being surfaced.

### Network webview provider is intentionally thin

`NetworkDevtoolsWebviewProvider` is almost a pure transport shim:

- `webview.onDidReceiveMessage(...)` forwards to `networkPlugin.handleWebviewMessage(...)`
- `networkPlugin.onMessageBroadcast(...)` forwards back to `webview.postMessage(...)`

All the stateful behavior lives below that level.

That tells us the actual product logic is in:

- collector strategy classes
- not the network UI webview provider

This is useful for further RE because it says:

- ignore the provider unless we specifically care about HTML/bootstrap
- focus on the strategy classes and the app-side interceptors

### AI and MCP consume the same normalized network store

The AI tooling does **not** appear to have a secret privileged network channel.

`getNetworkLogs()` in the MCP code does:

- `IDE.getInstanceIfExists()?.project`
- `project.deviceSession.getPlugin(NETWORK_PLUGIN_ID)`
- `networkPlugin.getNetworkLogs()`

So the AI path is reading from the same reconstructed network log model that the UI uses.

That is important because it means any gaps or distortions in the network inspector are inherited by Radon AI as well.

In other words:

- Radon AI is not observing the app more deeply than the extension itself
- it is consuming extension state

### Reverse-engineering conclusion for the network subsystem

The network inspector is best understood as a **multi-backend normalized telemetry pipeline**:

1. capture from JS bridge or debugger/native CDP
2. normalize in the extension
3. surface to webview and MCP tools

That is a much more robust architecture than a one-off devtool panel, and it also explains how Radon could keep evolving coverage:

- add a new collector
- keep the same normalized store
- keep the same consumer interfaces

## Radon AI / MCP Reverse Engineering

The MCP subsystem is also more sophisticated than the docs alone suggest.

It is not just:

- "call Radon servers"

and it is not just:

- "register local tools in the editor"

It is a hybrid architecture that merges:

- local live-debugging tools
- remote cloud-backed knowledge tools
- editor-specific registration compatibility layers
- a discovery mechanism for external agent CLIs

### Local MCP tools are backed by live IDE state

`registerLocalMcpTools(...)` registers local tools such as:

- `view_screenshot`
- `view_network_logs`
- `view_network_request_details`
- `reload_application`
- `view_component_tree`
- `view_application_logs`

These are not proxy calls to the cloud.

They are backed directly by:

- current device session
- current plugin state
- current output channels
- current screenshot capture path
- current devtools store

That makes Radon AI partly a thin API over the live IDE runtime.

### Remote MCP tools are fetched dynamically from Radon's backend

Remote tools are handled separately.

`LocalMcpServer.reloadRemoteToolsInternal()`:

- calls `fetchRemoteToolSchema()`
- compares returned tool names against the currently registered remote tools
- adds/removes registrations dynamically
- emits `toolListChanged` when the set changes

Actual remote invocation then goes through:

- `/api/tool_calls/`

with:

- bearer token from the current Radon license token

So the remote tools are schema-driven and server-defined. The local extension is acting as a host and compatibility layer for them.

### Radon AI is therefore a hybrid local/remote system

This is the most important architectural conclusion from the MCP pass.

Radon AI is **not** purely local and **not** purely remote.

It is:

1. local tool execution for live app/device/editor state
2. remote tool execution for knowledge/database-backed capabilities

That hybrid model lines up with the public docs:

- local debugging context
- remote documentation/knowledge access

But the readable code makes the split concrete.

### Network logs exposed to AI are intentionally redacted and bounded

The network-related MCP executors do not dump raw request objects unmodified.

`viewNetworkDetailsExec(...)`:

- clones the request
- redacts sensitive headers
- replaces large response bodies with a placeholder once they exceed the configured size threshold

`viewNetworkExec(...)`:

- pages the log output
- formats it into compact summaries

So the AI-facing network surface is intentionally:

- safer
- smaller
- more stable

than the raw internal request object graph.

That is an explicit design decision, not an accidental consequence.

### MCP server compatibility is editor-version dependent

The controller contains a compatibility matrix that is worth noting because it reveals product evolution.

`shouldUseDirectRegistering()` currently means:

- for VS Code `1.105.x` through `1.108.x`, Radon may directly register static tools with `lm.registerTool(...)`
- for newer VS Code versions, it prefers the MCP server/provider route

Separately:

- VS Code can use `lm.registerMcpServerDefinitionProvider(...)`
- Cursor can use `cursor.mcp.registerServer(...)`

So Radon AI is not built around one stable editor API. It contains versioned fallbacks and migration logic.

That is strong evidence that the team is optimizing for editor integration reliability, not just raw feature delivery.

### The local MCP server is discoverable by external CLIs through a cache record

`LocalMcpServer.updateMcpServerRecord()` writes a record under the app cache directory:

- `Mcp/radon-mcp-<md5(workspacePath)>.json`

The record contains:

- `workspaceFolder`
- `mcpServerUrl`

This is the missing implementation detail behind the public `radon-mcp` story.

The docs say external tools can discover the correct Radon MCP server for a workspace.

The shipped code shows how:

- hash the workspace path
- write a per-workspace record in the cache dir
- let the external proxy locate the active server URL from that record

That is a concrete RE result, not something visible from the docs alone.

### Radon cleans up old MCP registration formats

`cleanupOldMcpConfigEntries()` removes stale `RadonAi` entries from:

- `.vscode/mcp.json`
- `.cursor/mcp.json`

when they point at old HTTP-based entries.

This means the registration strategy has already changed at least once, and the extension ships migration cleanup for previous formats.

That is another sign that the MCP integration is a moving platform concern, not a fixed one-time implementation.

### Failure handling distinguishes auth failure from reachability failure

`handleRemoteToolsError(...)` treats failures differently:

- `ServerUnreachableError`
  - unload remote tools
  - retry later
- `AuthorizationError`
  - unload remote tools
  - do not treat it like a transient network problem

This is important because it tells us the extension considers:

- local tools as durable
- remote tools as conditional

The system is designed to degrade into a local-only toolset when the backend is unavailable or unauthorized.

### Reverse-engineering conclusion for Radon AI

The real architecture is:

1. a local MCP server embedded in the extension
2. live local tools backed by current IDE/app state
3. optional remote tools loaded from Radon's backend
4. multiple editor integration shims
5. external CLI discovery through cached workspace records

So "Radon AI" is less like a single chatbot feature and more like a distribution layer over Radon's internal observability/control surface plus a remote knowledge service.

## Connect Mode Reverse Engineering

Connect mode is also clearer now, and the most important result is that it is **intentionally thinner than panel mode**.

The code strongly supports the public docs claim that Connect mode is limited in feature scope.

### Scanner behavior is workspace-aware and conservative

`Scanner` polls Metro-like ports every `4s`:

- default ports `8081`, `8082`
- optional user-configured custom port

It probes:

- `http://localhost:<port>/status`

Then it checks the returned:

- `X-React-Native-Project-Root`

and only proceeds if that project root belongs to the current workspace.

So Connect mode is not trying to attach to any nearby Metro instance. It is deliberately scoped to Metro servers that look like they belong to the opened workspace.

That avoids accidental cross-project attachment.

### Connect mode requires the new debugger

After Metro is found, the scanner calls `waitForDebuggerTarget(...)` and rejects targets that are not using the new debugger.

If the target is on the old debugger path, the status becomes:

- `"using old debugger"`

and connection is not attempted.

So Connect mode is architecturally tied to the new debugger stack.

This is not just a product limitation listed in docs. The code enforces it.

### Expo Go target selection is careful about stale runtimes

When multiple new-debugger pages exist, the code does not blindly take the first one for Expo Go.

It evaluates:

- `globalThis.__expo_hide_from_inspector__ || 'runtime'`

over CDP to identify the active runtime and skip stale/inactive ones.

That means the debugger-target selection logic already contains product-specific heuristics for Expo runtime ambiguity.

This is a strong sign that Connect mode was built to handle real-world debugger target noise, not just happy-path demos.

### `ConnectSession` injects only a minimal runtime shim

This is the key design difference from panel mode.

`ConnectSession`:

- starts `DebugSessionImpl`
- waits for main bundle parse
- adds binding `__radon_binding`
- evaluates `dist/connect_runtime.js`

`connect_runtime.js` itself is tiny. It only provides:

- `globalThis.__radon_agent`
- `globalThis.__radon_dispatch`
- `agent.postMessage(...) -> globalThis.__radon_binding(JSON.stringify(message))`

That is a **transport shim**, not a full Radon runtime bootstrap.

### Connect mode does not boot the panel-mode wrapper stack

This is the critical reverse-engineering interpretation.

Panel mode depends on:

- `lib/runtime.js`
- `lib/wrapper.js`
- plugin registration globals
- app wrapper installation
- `appReady`
- navigation/inspector events
- tool/plugin negotiation

Connect mode does **not** inject those pieces.

Instead, it installs only the small binding-based bridge adapter.

So Connect mode is not:

- "panel mode with fewer UI controls"

It is:

- a different, much thinner runtime integration path

That explains why the public docs say Connect mode only supports debugging/logging today.

The limitation appears to be architectural, not merely a product switch waiting to be toggled on.

### Connect reuses the debugger infrastructure, not the full application session stack

`ConnectSession` uses:

- `DebugSessionImpl`
- a `DebugSessionInspectorBridge`

But it is not wired into:

- `Project`
- `DeviceSessionsManager`
- `ApplicationSession`
- `ToolsManager`
- preview/wrapper lifecycle

So it reuses the debugger substrate while bypassing most of the broader IDE orchestration.

This makes sense for its purpose:

- attach to already running external app/runtime
- provide debugger and console access
- avoid assuming full control over build/install/device lifecycle

### `DebugSessionInspectorBridge` is a lightweight transport adapter

`DebugSessionInspectorBridge` subclasses `InspectorBridge` and maps:

- binding callbacks from `Runtime.addBinding`
- into `emitEvent(type, data)`

Its `send(...)` path simply executes:

- `globalThis.__radon_dispatch(...)`

via debugger evaluation.

So the Connect bridge is effectively:

- InspectorBridge semantics
- carried over debugger binding/eval primitives

That is elegant, but it also means the bridge only becomes as capable as whatever runtime code has been installed on the app side.

In Connect mode, that installed runtime is just the thin `connect_runtime.js` shim.

### Status-bar UX reflects the thin architecture

The connector owns:

- enable/disable state
- scanner lifecycle
- connect/disconnect lifecycle
- status bar text/tooltip updates

It does not try to expose:

- preview control
- tool toggles
- device management
- launch/build orchestration

Again, that matches the architectural reality we see in code.

### Reverse-engineering conclusion for Connect mode

Connect mode is best understood as:

1. workspace-aware Metro discovery
2. debugger-target detection
3. thin debugger attachment
4. tiny runtime binding shim
5. status-bar driven UX

It is **not** a full second implementation of panel mode.

That is why it can support external devices and runtimes much more broadly, but with a narrower feature set.

## Simulator Helper Control Protocol Reverse Engineering

The native simulator helper is more understandable now that the extension-side wrapper has been traced.

The most important conclusion is this:

- the helper does **not** expose one big structured JSON API to the extension
- the extension talks to it over a small **stdin/stdout line protocol**
- the helper then translates that protocol into very different native backends depending on:
  - iOS simulator
  - Android emulator
  - Android physical device

So there are really two protocol layers to think about:

1. **extension -> helper**
   - plain-text command/event protocol
2. **helper -> actual device backend**
   - iOS private simulator bridge
   - Android emulator gRPC
   - Android physical-device agent / screen-sharing protocol

That split matters because it means the extension is mostly insulated from the per-platform native details.

### Startup protocol: helper mode is chosen at process launch

The extension resolves the platform helper binary using `simulatorServerBinary()` and spawns it from `Preview.start()`.

The initial argv shape is:

- `simulator-server-macos ios --id <deviceId> [-d <deviceSet>] [-t <licenseToken>]`
- `simulator-server-macos android --id <deviceId> [-t <licenseToken>]`
- `simulator-server-macos android_device --id <deviceId> [-t <licenseToken>]`

This means controller selection happens **before** the runtime control protocol starts.

So after startup, the extension no longer needs to care whether the target is:

- iOS simulator
- Android emulator
- Android physical device

It just writes runtime commands to stdin.

### The extension-side control protocol is line-oriented text

`Preview.sendCommand(...)` and `Preview.sendCommandOrThrow(...)` write newline-terminated strings to helper stdin.

There is no JSON framing on the command side.

Confirmed commands from the extension:

- `token <jwt>`
- `token RESET_LICENSE_TOKEN`
- `fps true`
- `fps false`
- `setUpKeyboard`
- `pointer show true`
- `pointer show false`
- `rotate <direction>`
- `copy_screenshot -r <rotation>`
- `touch <type> <x1,y1> [<x2,y2>]`
- `key <direction> <keyCode>`
- `button <direction> <button>`
- `paste START-SIMSERVER-PASTE>>><text><<<END-SIMSERVER-PASTE`
- `wheel <x,y> --dx <n> --dy <n>`
- `video <id> start -b <bufferSizeMB> [-m]`
- `video <id> stop`
- `video <id> save -r <rotation> [-d <secs> ...]`
- `screenshot <id> -r <rotation>`

The helper's embedded help strings confirm this is not accidental string concatenation in the extension. The binary contains runtime command parsers for:

- `setUpKeyboard`
- `rotate`
- `touch`
- `key`
- `button`
- `paste`
- `wheel`
- `video`
- `pointer`
- `token`
- `screenshot`
- `copy_screenshot`
- `fps`

So the extension is speaking the helper's intended CLI-like runtime grammar directly.

### Stdout is an event stream, not a response/reply protocol

The helper's stdout is parsed line-by-line in `Preview.start()`.

The extension looks for event prefixes such as:

- `stream_ready`
- `fps_report`
- `video_ready`
- `video_error`
- `screenshot_ready`
- `screenshot_error`

This means the protocol is not a request/response RPC system where every command gets a matched reply.

Instead it behaves more like:

- command fire-and-forget on stdin
- asynchronous events on stdout

That distinction explains a lot of the design downstream:

- screenshot and video capture are promise-based because the extension waits for later `*_ready` events
- simple input commands like `button` or `key` are not awaited in any meaningful protocol sense

### `stream_ready` starts a separate media channel

The helper emits:

- `stream_ready http://127.0.0.1:<port>/stream.mjpeg`

The extension extracts the URL with a regex and stores it as `previewURL`.

The binary strings also expose:

- `/stream.mjpeg`
- `multipart/x-mixed-replace;boundary=NextFrame`
- `simulator_server::mjpeg_server`

So the visual preview is not delivered over stdout.

The actual live screen path is:

- helper starts a local HTTP MJPEG server
- stdout announces the URL
- the panel/preview consumes that MJPEG stream separately

That gives us a clean three-channel model:

1. stdin text commands
2. stdout text events
3. local HTTP MJPEG video stream

### Multimedia export uses async IDs over the text protocol

Screenshot and video export are built around IDs rather than synchronous command completion.

The extension sends commands like:

- `screenshot screenshot -r <rotation>`
- `video replay save -r <rotation> -d 5 -d 10 -d 30`
- `video recording save -r <rotation>`

Then it waits for:

- `screenshot_ready <id> <url> <fileUrl>`
- `video_ready <id> <url> <fileUrl>`
- or the corresponding `*_error` events

That means the helper control protocol already contains a miniature async job model:

- caller chooses an ID
- helper later resolves or rejects that job by stdout event

### `copy_screenshot` is different from `screenshot`

This distinction is easy to miss.

There are two screenshot-related control paths:

1. `screenshot <id> -r <rotation>`
   - create/export a screenshot file
   - produces `screenshot_ready` / `screenshot_error`

2. `copy_screenshot -r <rotation>`
   - copy the last saved screenshot to the clipboard
   - binary strings show `copy_screenshot_error`

The extension currently only writes the `copy_screenshot` command and does not appear to wait on a structured success event for it.

So `copy_screenshot` behaves more like an imperative side-effect command than a normal async export job.

### Input coordinates are already normalized before the helper sees them

The helper protocol does not receive raw pixels from the panel.

The extension preprocesses input before sending:

- touch coordinates are normalized ratios
- touch coordinates are rotation-adjusted on the extension side
- wheel deltas are normalized to small discrete magnitudes

For touch specifically, the extension rotates the normalized points before writing:

- `touch <type> xRatio,yRatio [xRatio2,yRatio2]`

So the helper is not responsible for converting from panel-space into rotated device-space. That happens one layer earlier.

This is a useful RE boundary because it means:

- gesture semantics are partly in TS
- native helper mostly performs final dispatch

### Clipboard/paste is special-cased at the extension boundary

The extension does not blindly forward all keyboard combinations.

It tracks:

- left meta key
- right meta key

and suppresses raw `Cmd+C` / `Cmd+V` style key forwarding.

Instead, clipboard transfer goes through explicit paths:

- simulator clipboard APIs for iOS `pbcopy` / `pbpaste`
- helper `paste` runtime command for preview-side text injection

The helper strings confirm the paste protocol uses:

- `START-SIMSERVER-PASTE>>>`
- `<<<END-SIMSERVER-PASTE`
- `"Detected multi-line paste"`

So multiline paste is not a UI quirk. It is an explicit protocol feature.

### Pointer overlay is a separate runtime command family

The helper contains a `pointer` runtime command group, and the extension currently uses:

- `pointer show true`
- `pointer show false`

The embedded help strings also mention:

- pointer trail length

So the helper's runtime protocol is slightly broader than the extension currently exercises.

That suggests some helper capabilities are available but not fully surfaced in the TS layer.

### License state is part of the runtime protocol

License handling is not only a startup concern.

The helper accepts:

- initial `-t <license-token>` at process start
- later `token <jwt>` runtime updates
- `token RESET_LICENSE_TOKEN` on license removal

The helper binary strings also show:

- `token_not_provided shutting down`
- `token_valid`
- `token_invalid`

So the helper appears to contain its own time-based/access-based shutdown logic and does not rely entirely on the extension to decide whether it should continue mirroring.

That is important because it means the helper is partially self-policing for licensed functionality.

### iOS backend: private simulator bridge, not `simctl`

For iOS, the helper is clearly not just shelling out to `simctl` for interactive preview control.

The Objective-C method names inside `__objc_methname` show the iOS bridge contains selectors like:

- `registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:`
- `registerScreenAdapterCallbacksWithUUID:callbackQueue:screenConnectedCallback:screenWillDisconnectCallback:`
- `sendTouchAt:secondTouchAt:type:`
- `sendKeyEventWithKeyCode:keyDirection:`
- `sendButtonEventWithKeyCode:keyDirection:`
- `sendPaste:`
- `rotateWithDirection:`
- `setHardwareKeyboardEnabled:keyboardType:error:`
- `setKeyboardLanguage:error:`
- `touchMessageForTouchAt:secondTouchAt:direction:`
- `sendPurpleMessage:`
- `sendIndigoMessage:ofSize:`

This is a strong indication that the iOS controller is built on private Simulator/CoreSimulator-style APIs and lower-level message formats, not just public shell commands.

That matters because it explains why the helper can do things that `simctl` alone does not express as a clean interactive protocol:

- live frame callbacks
- direct touch injection
- direct key/button injection
- low-latency preview-oriented control

### Android emulator backend: helper text protocol -> emulator gRPC

For Android emulators, the helper strings show a different architecture entirely.

We can see:

- `grpc.port`
- `grpc.token`
- `Starting GRPC stream receiver`
- `GRPC stream ended`
- `android.emulation.control.EmulatorController/sendMouse`
- `android.emulation.control.EmulatorController/sendTouch`
- `android.emulation.control.EmulatorController/setClipboard`
- `android.emulation.control.EmulatorController/streamScreenshot`
- `android.emulation.control.EmulatorController/setPhysicalModel`
- `android.emulation.control.EmulatorController/getDisplayConfigurations`
- `android.emulation.control.EmulatorController/sendKey`

So the Android emulator path appears to work like this:

1. extension sends plain-text runtime commands to helper
2. helper translates them into emulator gRPC requests
3. helper re-exposes preview/results through the common stdout/MJPEG surface

This is exactly the kind of platform adaptation layer the TS code was hinting at.

### Android emulator backend: deeper reconstruction

At this point, the Android emulator path is no longer just "it uses gRPC somehow." There is enough evidence to say more about how that path is shaped internally.

#### The helper likely re-discovers the emulator gRPC endpoint by itself

This is a subtle but important point.

On the extension side:

- `AndroidEmulatorDevice.internalBootDevice()` parses the emulator `pid_*.ini`
- the extension reads:
  - `port.serial`
  - `port.adb`
  - `grpc.port`
  - `grpc.token`
- but `makePreview(...)` still creates the helper only with:
  - `deviceType: "android"`
  - `deviceId: this.serial`
  - optional license token

In other words, the extension does **not** pass the emulator gRPC port or gRPC token into `Preview`.

The helper binary, however, contains all of these strings:

- `TemporaryItems/avd/running`
- `pid_*.ini`
- `grpc.port`
- `grpc.token`
- `port.serial`
- `simulator_server::device_controller::android_emulator::emulator_info`
- `Failed to find any running emulator`
- `Connected`

That strongly suggests the helper re-scans the emulator runtime metadata itself, matches the booted emulator by serial, and resolves the gRPC endpoint from there.

So the Android emulator control path is likely:

1. extension knows only the emulator serial it wants to mirror
2. helper looks up the corresponding emulator run metadata
3. helper extracts `grpc.port` and `grpc.token`
4. helper connects to the emulator controller over gRPC

That is a cleaner separation than having the extension own the gRPC connection details.

#### The helper looks like a protocol adapter, not the source of emulator semantics

The visible gRPC method names line up with the runtime command families:

- runtime `touch` / `wheel`
  - likely end up at `sendTouch` and `sendMouse`
- runtime `key` / `button`
  - likely end up at `sendKey`
- runtime `paste`
  - likely involves `setClipboard`
- preview streaming
  - appears tied to `streamScreenshot`
- runtime `rotate`
  - likely maps through emulator display / physical-model state rather than a dedicated rotate RPC

That last point is especially interesting because no obvious `rotate` gRPC method name is exposed in the helper strings, but these strings do appear:

- `setPhysicalModel`
- `getDisplayConfigurations`
- `display_type`
- `device_states`
- `DisplayConfigurations`
- `device_state_id`
- `folded_display`
- `display_mode`
- `physical_properties`

So the most reasonable interpretation is that Android emulator rotation and related display-state behavior are implemented through the emulator's richer display/device-state model, not through a single purpose-built "rotate" primitive.

That is an inference, but it is a strong one.

#### The emulator preview path looks stream-oriented, not screenshot-per-request

The strings:

- `streamScreenshot`
- `Requesting screenshot stream`
- `Starting GRPC stream receiver`
- `GRPC stream ended`
- `Received pixel buffer`
- `Failed to convert PixelBuffer to Rgb`
- `Creating mmaped file`

point to a more specific media model than "the helper asks for screenshots."

The likely path is:

1. helper opens a long-lived screenshot/video stream from the emulator over gRPC
2. helper receives pixel buffers continuously
3. helper converts them into a format suitable for local serving
4. helper exposes the final preview through its MJPEG HTTP server

The `Creating mmaped file` string suggests the media path may use a mapped buffer as an intermediate staging area rather than copying everything through a simple in-memory pipeline.

Even if that exact staging detail ends up being slightly different, the core point is clear:

- Android emulator preview is treated as a stream receiver problem
- not just repeated one-shot screenshot RPCs

#### The emulator path clearly supports more than a phone-shaped happy path

The display-related strings imply the helper is aware of more complex emulator display topologies:

- `DisplayConfiguration`
- `DisplayConfigurations`
- `max_displays`
- `user_configurable`
- `display_type`
- `device_state_id`
- `device_states`

This makes the Android emulator backend look more like a generalized display-state adapter than a simple "mirror one fixed rectangle" system.

That matters for reverse engineering because it suggests Radon may be inheriting or reusing emulator capabilities aimed at:

- foldables
- posture-aware devices
- multiple displays
- richer device-state transitions

even if the current Radon UI only exposes a smaller subset.

#### Keyboard and button behavior are deliberately normalized at this layer

The binary strings give useful capability edges:

- `Android emulator does not require explicit keyboard setup`
- `GoHome`
- `GoBack`
- `Power`
- `AudioVolumeUp`
- `AudioVolumeDown`
- `AppSwitch`
- `Action button is not supported on Android`
- `+. No mapping to Android KeyEvent available.`

This tells us a few things:

- `setUpKeyboard` is effectively a no-op for emulator mirroring
- Radon's generic `button` command is translated into a backend-specific Android button enum
- not every host HID keycode has a valid Android `KeyEvent` equivalent
- Android support is broad, but it is not "all keys/buttons map perfectly"

That last limitation matters for RE because it explains why some input behavior is normalized or intercepted in the extension before it ever reaches the helper.

### Android emulator backend: live verification against a local AVD

This pass was also verified against a real local emulator session, not just strings and code.

#### [Observed] Local emulator metadata path and runtime values

A local AVD named `Cozea_Pixel_9` was started with the same core emulator flags Radon uses:

- `-qt-hide-window`
- `-no-boot-anim`
- `-grpc-use-token`
- `-no-snapshot-save`
- `-writable-system`

The emulator itself printed:

- `Started GRPC server at 127.0.0.1:8554, security: Local, auth: +token`
- `Advertising in: /Users/admin/Library/Caches/TemporaryItems/avd/running/pid_87318.ini`

The advertised runtime file then contained:

- `port.serial=5554`
- `port.adb=5555`
- `grpc.port=8554`
- `grpc.token=...`
- `avd.id=Cozea_Pixel_9`
- `grpc.jwks=...`

This is direct confirmation that the emulator exposes exactly the metadata shape the extension and helper strings were pointing at.

It also explains the earlier string set in the helper:

- `TemporaryItems/avd/running`
- `pid_*.ini`
- `port.serial`
- `grpc.port`
- `grpc.token`

#### [Observed] The helper really does connect to the emulator gRPC port and open a local server

With the emulator running as `emulator-5554`, the helper was started as:

- `simulator-server-macos android --id emulator-5554`

From live socket inspection of the helper process:

- it opened a local listener on `127.0.0.1:52845`
- it established an outbound TCP connection from `127.0.0.1:52846` to `127.0.0.1:8554`

That is stronger than the earlier inference. At least for this live session, the following is now confirmed:

- the helper consumes the emulator gRPC endpoint
- the helper opens its own separate local server for downstream preview consumption
- the helper eventually emitted:
  - `stream_ready http://127.0.0.1:52845/stream.mjpeg`
  - `MJPEG server started at http://127.0.0.1:52845/stream.mjpeg`

So the helper's advertised stdout contract is now live-verified for the emulator path, not just inferred from the extension parser.

The earlier HTTP timeout against `/stream.mjpeg` appears to have happened before the helper had fully reached the `stream_ready` state.

That timing detail is still unresolved, but the important part is now confirmed:

- the helper does produce the documented `stream_ready` event
- the helper does bind the advertised MJPEG endpoint locally

#### [Observed] Runtime command behavior seen on helper stdout

Two runtime command families were directly observed on helper stdout:

1. `fps true`
   - produced repeated events of the form:
     - `fps_report {"fps":...,"received":...,"dropped":...,"timestamp":...}`

2. `screenshot <id> -r Portrait`
   - produced explicit license-gating errors:
     - `Error when handling input command: Screenshot is not available for your license plan`

This is useful for several reasons:

- it confirms the helper's stdout event model is real in a live emulator session
- it confirms `fps_report` is generated by the helper itself, not synthesized by the extension
- it confirms screenshot/export commands are independently license-gated, even when preview streaming is otherwise active

So the earlier lack of `screenshot_ready` was not simply "stream not working." In this session, screenshot export was blocked specifically by license-plan enforcement.

#### [Observed] The emulator gRPC endpoint is authenticated and allowlisted

Using the `grpc.token` advertised in `pid_87318.ini`, direct authenticated gRPC calls against `127.0.0.1:8554` succeeded.

Important behavior:

- gRPC reflection was denied with:
  - `PermissionDenied`
  - `... not on the allowlist loaded from: emulator_access.json`
- direct method invocation with the shipped proto file worked

So the endpoint is:

- live
- token-protected
- restricted by an allowlist

That is useful because it means the helper almost certainly cannot rely on unrestricted reflection. It must know the emulator API shape ahead of time.

#### [Observed] Direct authenticated emulator RPCs that succeeded

Using the official local proto file:

- `/usr/local/share/android-commandlinetools/emulator/lib/emulator_controller.proto`

the following direct gRPC calls succeeded:

- `android.emulation.control.EmulatorController.getVmState`
  - returned `RUNNING`
- `android.emulation.control.EmulatorController.getDisplayConfigurations`
  - returned one active display with:
    - `width: 1080`
    - `height: 2424`
    - `dpi: 420`
  - and:
    - `userConfigurable: 3`
    - `maxDisplays: 11`
- `android.emulation.control.EmulatorController.getScreenshot`
  - returned a real PNG payload
- `android.emulation.control.EmulatorController.streamScreenshot`
  - returned a stream of image frames with increasing `seq` values

This directly confirms:

- the emulator screenshot API is real and working
- the display-configuration API is real and working
- the gRPC endpoint the helper connects to is the same endpoint documented by the local proto definitions

#### [Recovered from official proto] The media path the helper is built around is a screenshot stream, not a custom opaque blob

The local `emulator_controller.proto` explicitly defines:

- `rpc getScreenshot(ImageFormat) returns (Image)`
- `rpc streamScreenshot(ImageFormat) returns (stream Image)`

and the comments explain:

- a stream of screenshots is delivered as frames become available
- `ImageTransport` can optionally use `MMAP`
- the image payload can be delivered directly over gRPC or through a side channel

This is important for the helper RE because the helper strings included:

- `streamScreenshot`
- `Creating mmaped file`
- `Received pixel buffer`
- `Failed to convert PixelBuffer to Rgb`

So the earlier screenshot-stream model is no longer speculative in the abstract. The official emulator API itself already exposes a screenshot stream designed for exactly this kind of consumer.

#### [Recovered from official proto + helper strings] The display-state side is richer than simple rotation

The official emulator API exposes:

- `getDisplayConfigurations`
- `setDisplayConfigurations`
- `getDisplayMode`
- `setDisplayMode`
- `setPosture`
- `setPhysicalModel`

The helper binary strings, however, only exposed these relevant emulator RPC names:

- `sendMouse`
- `sendTouch`
- `setClipboard`
- `streamScreenshot`
- `setPhysicalModel`
- `getDisplayConfigurations`
- `sendKey`

Notably absent from helper strings:

- `setPosture`
- `setDisplayMode`
- `getDisplayMode`
- `streamNotification`

That narrows the plausible backend path for helper-driven emulator rotation/control.

It does **not** prove the exact implementation, but it does strengthen one specific conclusion:

- if the helper is changing Android emulator orientation/state through the gRPC API, `setPhysicalModel` is the most visible candidate in the shipped binary

That is a narrower and better-supported claim than the earlier broader "it probably uses display/device-state APIs somehow."

#### [Inferred, high confidence] The helper likely discovers `grpc.port` and `grpc.token` from runtime metadata instead of receiving them from the extension

This remains an inference because the exact helper control flow was not decompiled.

However, the supporting evidence is now stronger:

- the extension only passes `--id emulator-5554` to the helper
- the extension does **not** pass `grpc.port` or `grpc.token`
- the helper binary contains:
  - `TemporaryItems/avd/running`
  - `pid_*.ini`
  - `port.serial`
  - `grpc.port`
  - `grpc.token`
  - `android_emulator::emulator_info`
- the live emulator session actually created `pid_87318.ini` with exactly those fields
- the live helper process did establish a connection to `127.0.0.1:8554`

So while not yet directly decompiled, the runtime-metadata discovery path is now the most evidence-supported explanation.

#### [Observed] `rotate` is helper-gated before any emulator RPC in this build/plan

When the runtime command:

- `rotate LandscapeLeft`

was sent to the live helper session, the helper immediately printed:

- `Error when handling input command: DeviceRotation is not available for your license plan`

and the gRPC proxy captured **no new emulator RPC** associated with that command.

So for this specific observed build/plan combination, the strongest supported conclusion is:

- `rotate` does **not** reach the emulator backend at all when the helper rejects it for licensing

This is more precise than saying "rotate probably maps to X."

What remains true from static analysis is only this:

- if rotation were allowed, `setPhysicalModel` remains the strongest visible emulator-side candidate in the helper binary

But that backend path was **not** exercised live in this session, so it should remain a recovered candidate, not a confirmed live mapping.

#### [Recovered from extension JS] Radon forwards named rotations directly to the helper

The extension-side rotation flow is now constrained enough to describe precisely.

The relevant pieces are:

- `Project.rotateDevices(direction)` does **not** call the helper directly; it cycles workspace state through:
  - `LandscapeLeft`
  - `Portrait`
  - `LandscapeRight`
  - `PortraitUpsideDown`
- `DeviceSession` watches `deviceSettings.deviceRotation` and calls:
  - `this.device.sendRotate(deviceRotationResult)`
- `BaseDevice.sendRotate(rotation)` stores the enum locally and forwards it to preview:
  - `this.preview?.rotateDevice(rotation)`
- `Preview.rotateDevice(rotation)` writes the literal stdin command:
  - ``rotate ${rotation}``

So on the Radon side there is no hidden numeric conversion before the helper boundary:

- the extension chooses one of the four string enum values
- the preview layer sends that exact string to `simulator-server-macos`

That matters because it narrows where the Android-specific interpretation can happen:

- **not** in `Project.rotateDevices(...)`
- **not** in `DeviceSession`
- **not** in `Preview.rotateDevice(...)`
- only in the helper/backend after it receives `rotate LandscapeLeft`, `rotate LandscapeRight`, etc.

#### [Recovered from extension JS] Radon's own touch math defines `LandscapeLeft` as a 90° anticlockwise screen rotation

This is one of the most useful internal clues for understanding the semantics of the named rotations.

When Radon sends touches to the helper, it rewrites normalized coordinates based on the stored device rotation:

- `LandscapeLeft`: `(x, y) -> (1 - y, x)`
- `LandscapeRight`: `(x, y) -> (y, 1 - x)`
- `PortraitUpsideDown`: `(x, y) -> (1 - x, 1 - y)`

The `LandscapeLeft` branch is even commented in the bundle as:

- `90° anticlockwise map (x,y) to (1-y, x)`

This does **not** prove the helper/emulator implementation by itself, but it does establish Radon's intended meaning for the enum names at the UI/runtime boundary:

- `LandscapeLeft` means "screen rotated 90° anticlockwise / left"
- `LandscapeRight` means the opposite landscape orientation

#### [Observed] On this non-resizable AVD, emulator landscape orientation is driven through `setPhysicalModel`, not `setDisplayMode`

This part was tested directly against the local emulator gRPC endpoint exposed by the running AVD.

First, `getDisplayMode` was checked and failed with:

- `FailedPrecondition`
- `:getDisplayMode the AVD is not resizable.`

That is important because it removes one entire candidate path for **this** emulator configuration:

- `setDisplayMode` / `getDisplayMode` are not the mechanism for landscape rotation here

Next, the physical-model path was driven directly.

Observed results:

- baseline portrait state after reset:
  - `setPhysicalModel(target=ROTATION, value=[-4.7500005, 0, 0])`
  - `getScreenshot(...)` then reported portrait-style dimensions:
    - `width: 28`
    - `height: 64`
  - screenshot metadata no longer reported a landscape enum
- forcing `zAxis = +90`:
  - `setPhysicalModel(target=ROTATION, value=[0, 0, 90])`
  - `getScreenshot(...)` then reported:
    - `rotation.rotation = LANDSCAPE`
    - `rotation.zAxis = 90`
    - `width: 64`
    - `height: 28`
- forcing `zAxis = -90`:
  - `setPhysicalModel(target=ROTATION, value=[0, 0, -90])`
  - `getScreenshot(...)` then reported:
    - `rotation.rotation = REVERSE_LANDSCAPE`
    - `rotation.zAxis = -90`
    - `width: 64`
    - `height: 28`

This is now the strongest emulator-side evidence we have for how Android landscape works underneath the helper:

- on this AVD, landscape orientation can be induced directly by writing the `ROTATION` physical model
- the sign of the `zAxis` controls which landscape variant the emulator reports
- the screenshot API reflects that state immediately in its returned rotation metadata

That is a materially stronger conclusion than the earlier static-only claim that "`setPhysicalModel` is a likely candidate."

#### [Inferred, high confidence] If the helper were allowed to honor `rotate LandscapeLeft`, the most likely backend mapping is `LandscapeLeft -> zAxis +90` and `LandscapeRight -> zAxis -90`

This remains an inference because the helper's licensed `rotate` path could not be executed live.

However, the combined evidence now points in one direction:

- Radon sends the literal strings `LandscapeLeft` / `LandscapeRight` to the helper
- Radon's own touch transform defines `LandscapeLeft` as a 90° anticlockwise rotation
- the emulator proto defines:
  - `LANDSCAPE` as `90 degrees`
  - `REVERSE_LANDSCAPE` as `-90 degrees`
- direct gRPC experiments showed:
  - `zAxis = +90` -> `LANDSCAPE`
  - `zAxis = -90` -> `REVERSE_LANDSCAPE`

So the best current evidence-based reconstruction is:

- `rotate LandscapeLeft`
  - likely maps to emulator `setPhysicalModel(ROTATION=[0, 0, 90])`
  - which the emulator reports as `LANDSCAPE`
- `rotate LandscapeRight`
  - likely maps to emulator `setPhysicalModel(ROTATION=[0, 0, -90])`
  - which the emulator reports as `REVERSE_LANDSCAPE`

This should still be kept at **inferred** rather than **observed**, because the helper's own translation branch is still hidden behind the plan gate in the tested build.

#### [Observed] `wheel` does not use `injectWheel`; it is translated into a burst of `sendMouse` RPCs

This was one of the more useful live findings.

When the runtime command:

- `wheel 0.5,0.5 --dx 3 --dy -3`

was sent to the helper, the proxy captured **five consecutive unary** requests to:

- `android.emulation.control.EmulatorController/sendMouse`

and **no** requests to:

- `injectWheel`

The decoded request payloads were:

1. `x: 540 y: 1212 buttons: 1`
2. `x: 720 y: 808 buttons: 1`
3. `x: 899 y: 404 buttons: 1`
4. `x: 1079 buttons: 1`
5. `x: 1259 y: -403`

An opposite-direction command:

- `wheel 0.5,0.5 --dx -3 --dy 3`

produced the mirrored pattern, again using only `sendMouse`:

1. `x: 540 y: 1212 buttons: 1`
2. `x: 360 y: 1616 buttons: 1`
3. `x: 180 y: 2019 buttons: 1`
4. `y: 2423 buttons: 1`
5. `x: -179 y: 2827`

This is enough to say, from direct observation:

- the helper does **not** map the panel `wheel` command to the emulator's public `injectWheel` RPC
- instead, it synthesizes a short sequence of `sendMouse` calls
- the first `sendMouse` event is anchored at the normalized input point converted to display pixels
- intermediate events keep `buttons: 1`, which strongly suggests a pressed-drag gesture
- the last event omits `buttons`, which strongly suggests a release/end event

So the emulator-wheel behavior is not "real wheel injection" in this helper path.

It is a gesture translation layer built on top of mouse events.

#### [Unresolved] Exact runtime-command to gRPC-method mapping is still only partially proven

The following mappings are strongly suggested by helper strings and official API names:

- runtime `touch` -> `sendTouch`
- runtime `wheel` -> a burst of unary `sendMouse` calls that emulate a pressed mouse-drag gesture
- runtime `key` / `button` -> `sendKey`
- runtime `paste` -> `setClipboard`
- preview stream -> `streamScreenshot`
- rotation/state change -> blocked by helper-side license gating in the observed session; if allowed, `setPhysicalModel` remains the strongest visible backend candidate

But these should still be treated carefully:

- no packet capture of the helper's gRPC `:path` was collected
- no helper decompilation was performed yet
- the exact `rotate` payload shape is still unresolved
- the exact preview-start sequencing is still unresolved, because the helper opened sockets before `stream_ready` was observed and the MJPEG endpoint did not answer immediately during earlier probes

So for now:

- `streamScreenshot` is the strongest confirmed media-side candidate
- `setPhysicalModel` is the strongest recovered rotation/state candidate
- `wheel` is now live-confirmed as mouse-gesture synthesis over repeated `sendMouse` calls, not `injectWheel`
- `sendTouch`, `sendKey`, and `setClipboard` are high-confidence but still not yet packet-level confirmed helper calls

### Android physical-device backend: richer internal protocol behind the same text shell

The Android physical-device path looks different again.

Binary strings expose:

- screen-sharing agent startup
- agent file push to `/data/local/tmp/.studio`
- video/control protocol symbols such as:
  - `MotionEvent`
  - `KeyEvent`
  - `TextInput`
  - `SetDeviceOrientation`
  - `RequestDeviceState`
  - `DisplayConfigurationRequest`
  - `DisplayConfigurationResponse`
  - `UiSettingsRequest`
  - `UiSettingsChangeRequest`
  - `ClipboardChangedNotification`

So the helper likely speaks a richer protobuf-like or message-framed internal protocol to the on-device agent, while still presenting the extension with the same simple text command surface.

This is another strong architectural pattern:

- simple stable edge protocol for the extension
- more complex backend-specific protocol hidden inside the helper

### Android physical-device backend: deeper reconstruction

The physical-device path is now much more specific than "there is an Android agent."

The helper leaks its own Rust module layout:

- `src/device_controller/android_device.rs`
- `src/device_controller/android_device/connection.rs`
- `src/device_controller/android_device/agent.rs`
- `src/device_controller/android_device/video.rs`
- `src/device_controller/android_device/control.rs`
- `src/device_controller/android_device/protocol.rs`
- `src/device_controller/android_device/protocol/base_128_stream.rs`
- `src/device_controller/android_device/protocol/control_messages.rs`
- `src/device_controller/android_device/protocol/device_state.rs`
- `src/device_controller/android_device/protocol/control_messages/writable.rs`

That is strong evidence that the physical-device path is explicitly split into:

1. agent lifecycle / deployment
2. connection management
3. video transport
4. control transport
5. a dedicated message codec

So this is not a thin shell wrapper around `adb shell input`.

It is a full remote-control stack.

#### The packaged Android agent is overwhelmingly native

The shipped `screen-sharing-agent.jar` contains:

- `classes.dex` through `classes6.dex`
- four ABI-specific copies of `libscreen-sharing-agent.so`

The packed size split is extremely lopsided:

- native `.so` payload: about **99.37%**
- dex payload: about **0.61%**

That means the agent logic is not mainly Java/Kotlin.

The Java/Dex side looks like a bootstrap shell, while the real behavior lives in native code.

That interpretation is reinforced by strings such as:

- `Java_com_android_tools_screensharing_Main_nativeMain`
- `loadLibrary0`
- `/data/local/tmp/.studio/screen-sharing-agent.jar`
- `/data/local/tmp/.studio/libscreen-sharing-agent.so`

So the physical-device path likely works like this:

1. helper pushes the jar and matching native library to `/data/local/tmp/.studio`
2. a tiny Java bootstrap loads the native library
3. execution jumps into a native main/control loop

This is a much more serious runtime than a simple shell script or accessibility macro.

#### The helper is acting as an agent manager over `adb`

The helper strings show operational concerns around agent deployment and lifecycle:

- `Pushing screen sharing agent files to device`
- `Agent process started, waiting for connections`
- `All agent connections established successfully`
- `Timeout waiting for agent connections`
- `Stopping Android screen sharing agent process`
- `Killing screen sharing agent process due to shutdown request`
- device-side paths under `/data/local/tmp/.studio`

So the host helper is not merely forwarding commands.

It is responsible for:

- selecting the correct ABI payload
- pushing agent artifacts
- starting the agent
- waiting for control/video channels
- tearing it down cleanly

That makes the host helper a proper supervisor for the on-device runtime.

#### The physical-device protocol looks custom and base-128 framed

The protocol module names are the biggest clue here:

- `protocol/base_128_stream.rs`
- `protocol/control_messages.rs`
- `protocol/control_messages/writable.rs`

Together with message-type names like:

- `MotionEvent`
- `KeyEvent`
- `TextInput`
- `SetDeviceOrientation`
- `SetMaxVideoResolution`
- `StartVideoStream`
- `StopVideoStream`
- `StartClipboardSync`
- `StopClipboardSync`
- `RequestDeviceState`
- `DisplayConfigurationRequest`
- `DisplayConfigurationResponse`
- `ClipboardChangedNotification`
- `SupportedDeviceStatesNotification`
- `DeviceStateNotification`
- `DisplayAddedOrChangedNotification`
- `DisplayRemovedNotification`

the strongest reading is:

- this is a bespoke framed message protocol
- it fills the same role people might loosely call "protobuf-like"
- but the implementation details likely differ from vanilla protobuf, because the helper explicitly references its own base-128 stream codec

So the Android physical-device backend is not just "gRPC but on-device."

It is a separate custom protocol family.

#### The agent exposes richer device-state and UI-setting control than Radon currently surfaces

This is one of the most interesting findings from the Android side.

The agent strings expose a large settings/control surface:

- dark mode
- font scale
- density
- TalkBack
- Select to Speak
- gesture navigation
- debug layout
- app locale changes
- reset-to-original-settings support
- foreground application tracking
- accessibility service tracking

The symbols are explicit:

- `UiSettingsRequest`
- `UiSettingsResponse`
- `UiSettingsChangeRequest`
- `ResetUiSettingsRequest`
- `SetDarkMode`
- `SetFontScale`
- `SetScreenDensity`
- `SetTalkBack`
- `SetSelectToSpeak`
- `SetGestureNavigation`
- `SetDebugLayout`
- `SetAppLanguage`

and the strings also mention:

- `-- Foreground Application --`
- `-- Accessibility Services --`
- `com.google.android.marvin.talkback`
- `SelectToSpeakService`

So the on-device agent appears capable of much more than the current Radon panel visibly exposes.

That suggests Radon is sitting on top of a deeper Android device-control substrate than its present UI immediately reveals.

#### Display polling and device-state notifications are first-class concepts

The physical-device strings include:

- `Controller::StartDisplayPolling`
- `Controller::PollDisplays`
- `Received display added/changed notification`
- `No displays found in device response`
- `Controller::OnDeviceStateChanged(%d)`
- `DisplayAddedOrChangedNotification`
- `DisplayRemovedNotification`
- `SupportedDeviceStatesNotification`

That means the agent is not just streaming a single framebuffer.

It actively monitors:

- which displays exist
- when display configuration changes
- device state transitions

This again points toward broader support for:

- foldables
- posture/state-aware devices
- multi-display changes

even if the current extension only uses a narrower slice.

#### Video and clipboard sync are independent channels, not side effects of input injection

The physical-device path appears to have dedicated subsystems for:

- video streaming
- clipboard sync
- control messages

rather than stuffing everything into one generic connection.

Evidence:

- separate helper module names: `video.rs`, `control.rs`, `connection.rs`
- strings like:
  - `StartVideoStream`
  - `StopVideoStream`
  - `StartClipboardSync`
  - `StopClipboardSync`
  - `ClipboardChangedNotification`
  - `H264 frame submitted for decoding`
  - `Received video packet with size 0, skipping`

So the physical-device backend looks like:

- control plane
- video plane
- clipboard/state notification plane

with the host helper coordinating them into the common Radon preview protocol.

#### One likely origin: upstream Android Studio / IntelliJ streaming infrastructure

The packaged README already pointed upstream to Android Studio screen-sharing resources.

The native strings reinforce that reading with paths such as:

- `/Users/balins/old/idea/streaming/screen-sharing-agent/app/src/main/cpp/agent.cc`
- `/Users/balins/old/idea/streaming/screen-sharing-agent/app/src/main/cpp/socket_reader.cc`
- `/Users/balins/old/idea/streaming/screen-sharing-agent/app/src/main/cpp/socket_writer.cc`
- Java symbols under `com.android.tools.screensharing`

So the best current interpretation is:

- the Android physical-device substrate is not a fully custom Radon invention
- it is built on top of Android Studio / JetBrains screen-sharing agent infrastructure
- Radon's value is in integrating that substrate into its own preview/control/runtime stack

That lines up cleanly with the earlier README clue and with the module names exposed by the native payload.

#### Physical-device limitations still show through the abstraction

The unified runtime protocol hides a lot of backend complexity, but not all of it.

One explicit limitation is:

- `Setting RotateDirection::PortraitUpsideDown is currently not supported due to screen sharing agent limitations.`

That matches the extension-side guard where `AndroidPhysicalDevice.sendRotate(...)` refuses `PortraitUpsideDown`.

So the abstraction is good, but not perfect:

- the extension presents a generic rotate command
- the physical-device backend narrows the supported subset

### Button semantics are backend-specific under a unified command

The extension always sends:

- `button <direction> <button>`

but the helper/backend semantics differ.

Strings confirm button enums such as:

- `Home`
- `Back`
- `VolumeUp`
- `VolumeDown`
- `ActionButton`
- `AppSwitch`

and also platform restrictions:

- `Back button is not supported on iOS`
- `Action button is not supported on Android`

So `button` is a cross-platform abstraction, not a guarantee that every button exists everywhere.

That is useful when reading the TS layer:

- the Project API looks uniform
- the helper enforces the actual platform capability matrix

### Not all device control flows through the helper

This is an important correction to earlier high-level intuition.

The helper is **not** the universal control plane for all device settings.

Examples outside the helper:

- iOS appearance/content size/location/biometrics are changed via `xcrun simctl`
- iOS clipboard read/write uses `simctl pbcopy` / `pbpaste`
- Android emulator locale/font scale/location changes use `adb shell settings` and `emu geo fix`
- Android emulator camera changes are written to `config.ini`
- Android port forwarding uses `adb reverse`

So the helper is best understood as:

- preview
- input injection
- recording/replay/screenshot export
- some keyboard/orientation glue

but **not** the whole device-management layer.

### Practical reconstructed protocol model

The best current model of the simulator helper control protocol is:

1. **spawn phase**
   - choose controller: `ios`, `android`, or `android_device`
   - pass `--id`, optional `--device-set`, optional `-t`

2. **control phase**
   - extension writes line-based runtime commands to stdin

3. **event phase**
   - helper emits line-based status/events on stdout
   - only `fps_report` contains embedded JSON

4. **media phase**
   - helper serves MJPEG preview over local HTTP
   - export jobs surface file URLs through stdout events

5. **backend phase**
   - iOS: private simulator bridge / Purple/Indigo-style messaging
   - Android emulator: emulator gRPC control
   - Android physical device: on-device screen-sharing/control agent

That is a much clearer and more constrained picture than "opaque native binary."

## Parity RE TODO Matrix

This section is specifically for a **pinpoint-accurate reimplementation of Radon preview technology**.

The goal here is not "rough feature parity."
The goal is to identify which subsystems must be understood closely enough that behavior, lifecycle, and protocol assumptions are not guessed.

### Highest-priority remaining work

1. **Android emulator helper command map**
   - Status: partially recovered
   - Strongly supported:
     - preview stream -> `streamScreenshot`
     - `wheel` -> repeated `sendMouse`
     - landscape rotation backend -> `setPhysicalModel(ROTATION)` on the tested non-resizable AVD
   - Still missing:
     - packet-level proof for `touch`
     - packet-level proof for `key` / `button`
     - packet-level proof for `paste`
     - exact `pointer show true/false` implementation
     - exact preview-start sequencing before `stream_ready`

2. **MJPEG / screenshot / recording / replay media pipeline**
   - Status: partially recovered from JS and helper strings
   - Strongly supported:
     - preview is served over local MJPEG HTTP
     - screenshot / video / replay export are separate helper command families
     - replay has multi-duration save behavior
   - Still missing:
     - exact image conversion path
     - exact frame buffering behavior
     - exact recording container/encoder details
     - exact replay segmentation/saving strategy inside the helper

3. **iOS simulator native backend**
   - Status: surface only
   - Strongly supported:
     - private iOS simulator bridge exists
     - frame callback registration exists
     - HID-style input injection exists
   - Still missing:
     - exact frame acquisition path
     - exact rotation path
     - exact keyboard/button/touch message translation
     - exact clipboard/screenshot/export behavior

4. **Android physical-device backend**
   - Status: host/helper and bootstrap layers partly recovered; native core still unresolved
   - Strongly supported:
     - host helper supervises a real on-device runtime
     - runtime protocol has explicit control/video/clipboard-state message types
     - most of the behavior lives in the native `.so`
   - Still missing:
     - numeric message schema
     - full socket/bootstrap flow
     - host<->device message directionality per message type
     - exact orientation/video-resolution/display-control behavior

5. **Preview runtime behavior inside the RN app**
   - Status: high-level behavior recovered
   - Strongly supported:
     - Radon injects runtime and wrapper code
     - preview mode swaps the running app root and pushes synthetic navigation state
   - Still missing:
     - exact preview registration shape from the `radon-ide` package
     - exact `openPreview` payload shape end-to-end
     - exhaustive preview/runtime differences between normal mode, preview mode, and Storybook mode

6. **Compatibility matrix across RN / Expo versions**
   - Status: conceptual only
   - Strongly supported:
     - Radon conditionally patches RN internals across version ranges
   - Still missing:
     - exact replacement table
     - exact semver/version predicates
     - which patches are required for preview parity vs inspector/debugger stability

### Lower-priority for preview reimplementation

These are useful for a full Radon clone, but not on the critical path for embedded preview parity:

- Radon AI / MCP
- Network inspector
- Redux / Apollo / React Query tool hosting
- pricing / license UX beyond whatever is needed to understand gated preview behaviors

## Additional RE Findings

### The public `radon-ide` repository available locally is not source for the shipped extension

The local clone at:

- `/Users/admin/Downloads/radon-ide-download/radon-ide-public-src`

contains:

- top-level README
- docs site under `packages/docs`
- media/assets/changelog/docs content

It does **not** currently expose the extension implementation files corresponding to the shipped package:

- no `dist/extension.js` source tree
- no helper/native backend sources
- no `lib/runtime.js` / `lib/wrapper.js` implementation tree
- no preview/controller/device-session source code

Practical consequence:

- for the shipped beta build, the extracted package is currently the primary implementation source of truth
- the public repo is still useful for product surface / docs / public API hints
- but it is not enough on its own for a faithful reimplementation of preview behavior

### JS-side preview lifecycle is now much more concrete

The preview control path in the extension bundle is now constrained enough to describe accurately.

Observed/recovered behavior:

- `DeviceBase.startPreview(...)`
  - creates the `Preview`
  - subscribes to close/events
  - calls `preview.start()`
  - only after start resolves does it call `applyPreviewSettings()`
- `Preview.start()`
  - spawns `simulator-server-*`
  - passes:
    - controller type: `ios` / `android` / `android_device`
    - `--id`
    - optional `--device-set`
    - optional `-t` license token
  - resolves only when helper stdout emits `stream_ready http://.../stream.mjpeg`
- after the stream is ready, `applyPreviewSettings()` replays the current config into the helper:
  - `video replay start/stop`
  - `pointer show true/false`
  - `rotate <direction>`

So preview startup is not:

- spawn helper and immediately start sending state

It is:

1. spawn helper
2. wait for `stream_ready`
3. then apply persistent preview state

This matters for parity because it explains why preview settings are replayed after reconnect/restart rather than being assumed during helper bootstrap.

### Recording / replay / screenshot orchestration is higher-level than the raw helper

The extension-side capture subsystem is now much clearer.

Recovered behavior:

- recording:
  - starts helper video recording with:
    - `video recording start -b 2000`
  - keeps a local timer in the extension
  - auto-stops after `10 * 60` seconds
- replay:
  - starts helper replay capture with:
    - `video replay start -m -b 50`
  - `-m` indicates in-memory mode in the helper command surface
  - save requests are issued later with multiple durations:
    - `5`
    - `10`
    - `30`
    - plus the "full" replay event case
- screenshot:
  - uses helper `screenshot screenshot -r <rotation>`
  - if the saved result is `"saved"`, the extension then separately issues:
    - `copy_screenshot -r <rotation>`

Important implementation detail:

- screenshot clipboard copy is **not** the same operation as screenshot capture
- it is a second helper command triggered only after the save dialog path returns `"saved"`

Another subtle detail:

- helper strings include `copy_screenshot_error`
- the extension bundle does **not** appear to parse a dedicated `copy_screenshot_*` stdout event family

That means clipboard-copy failure handling may be asymmetric relative to screenshot/video export, which is exactly the kind of small behavior difference that can matter in a faithful clone.

### The helper command/event vocabulary is now essentially recovered on the JS boundary

From the shipped bundle, the preview-side runtime command vocabulary includes:

- `token <jwt>`
- `fps true|false`
- `setUpKeyboard`
- `pointer show true|false`
- `rotate <direction>`
- `copy_screenshot -r <rotation>`
- `video <id> start ...`
- `video <id> stop`
- `video <id> save -r <rotation> ...`
- `screenshot <id> -r <rotation>`
- `touch <type> <coords...>`
- `key <direction> <keyCode>`
- `button <direction> <button>`
- `paste START-SIMSERVER-PASTE>>>...<<<END-SIMSERVER-PASTE`
- `wheel <x,y> --dx <n> --dy <n>`

Recovered stdout event vocabulary includes:

- `stream_ready`
- `fps_report {json}`
- `video_ready`
- `video_error`
- `screenshot_ready`
- `screenshot_error`

This means the unknowns are now less about "what commands exist" and more about:

- how the native helper interprets each command per backend
- what exact media/protocol machinery sits behind those commands

### iOS simulator backend: stronger evidence for a private bridge with frame callbacks and HID injection

The iOS backend is still native-only, but at this point the Objective-C metadata plus x86_64 disassembly expose a large amount of real behavior. This is now beyond a vague “private bridge exists” statement.

Recovered strings/selectors include:

- Objective-C class:
  - `SimulatorControl`
- `iOS simulator bridge initialized`
- `Failed to initialize iOS simulator bridge`
- `Setting up keyboard for iOS simulator bridge`
- `Registering frame callback for iOS simulator bridge`
- `Frame callback registered`
- `rotateWithDirection:`
- `sendIndigoMessage:ofSize:`
- `sendPurpleMessage:`
- `PurpleWorkspacePort`
- `IndigoHIDMessageForMouseNSEvent`
- `IndigoHIDMessageForKeyboardArbitrary`
- `IndigoHIDMessageForButton`
- `IOSurface`
- `initWithCGImage:size:`
- `Could not rotate pixel buffer`
- `com.apple.SimulatorKit`
- `Contents/Developer/Library/PrivateFrameworks/SimulatorKit.framework`
- `com.apple.dt.Xcode`
- `sharedServiceContextForDeveloperDir:error:`
- `registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:`
- `screenProperties`
- `screenID`
- `io`
- `ioPorts`
- `descriptor`
- `enumerateScreensWithCompletionQueue:completionHandler:`

Recovered from Objective-C metadata (`otool -ov`), the `SimulatorControl` class exposes methods such as:

- `initWithUDID:deviceSet:`
- `registerSimulatorFrameCallback:`
- `rotateWithDirection:`
- `touchMessageForTouchAt:secondTouchAt:direction:`
- `sendIndigoMessage:ofSize:`
- `sendKeyEventWithKeyCode:keyDirection:`
- `sendButtonEventWithKeyCode:keyDirection:`
- `sendTouchAt:secondTouchAt:type:`
- `sendPurpleMessage:`
- `sendPaste:`
- `setUpKeyboard`
- `getSimulatorAppSymbol:`

Recovered ivars on `SimulatorControl`:

- `_device` of type `SimDevice`
- `_simDeviceClient` of type `SimDeviceLegacyClient`
- `_MessageForMouseNSEvent`
- `_MessageForKeyboardArbitrary`
- `_MessageForButton`
- `_dispatchQueue`

Recovered behavior from the `SimulatorControl` method bodies:

#### `initWithUDID:deviceSet:`

- calls a helper that resolves the installed Xcode bundle via `NSWorkspace URLForApplicationWithBundleIdentifier:`
- appends `Contents/Developer/Library/PrivateFrameworks/SimulatorKit.framework`
- loads that framework through `NSBundle bundleWithPath:` / `load`
- looks up `SimServiceContext`
- calls `sharedServiceContextForDeveloperDir:error:`
- chooses either `deviceSetWithPath:error:` or `defaultDeviceSetWithError:`
- enumerates `availableDevices`
- matches the requested device by `UDID`
- checks the selected device `state` equals `3` before proceeding
- resolves simulator HID entrypoints dynamically through `getSimulatorAppSymbol:` for:
  - `IndigoHIDMessageForMouseNSEvent`
  - `IndigoHIDMessageForKeyboardArbitrary`
  - `IndigoHIDMessageForButton`
- instantiates a `SimDeviceLegacyClient` via `initWithDevice:error:`
- runs `setUpKeyboard`
- reads the current macOS keyboard input source and forwards the language into the simulator via `setKeyboardLanguage:error:`
- creates a dedicated queue named `com.simulatorServer.dispatchQueue`

Recovered from direct x86_64 disassembly of `0x100335170`, the implementation ordering is now tighter than the earlier selector-level read:

- `[[super init] ...]` must succeed first
- framework loading is gated through an earlier helper before any simulator work proceeds
- device set selection is exactly:
  - explicit path -> `deviceSetWithPath:error:`
  - otherwise -> `defaultDeviceSetWithError:`
- device lookup is a real `availableDevices` fast-enumeration loop over candidate `SimDevice` objects
- the matched `SimDevice` is written directly into ivar slot `+0x8`
- boot validation is a strict equality check on `state == 3`
- the cached Indigo builders are written into ivar slots:
  - `+0x18` -> `IndigoHIDMessageForMouseNSEvent`
  - `+0x20` -> `IndigoHIDMessageForKeyboardArbitrary`
  - `+0x28` -> `IndigoHIDMessageForButton`
- `SimDeviceLegacyClient` is allocated dynamically and written into ivar slot `+0x10`
- `setUpKeyboard` runs before the dispatch queue is created

So for reimplementation purposes, `initWithUDID:deviceSet:` is a concrete ordered bootstrap:

1. load SimulatorKit path / symbols
2. resolve device set
3. match booted device
4. cache Indigo builders
5. build `SimDeviceLegacyClient`
6. run keyboard setup
7. create dispatch queue

#### `getSimulatorAppSymbol:`

- looks up a bundle by identifier, with surrounding strings strongly indicating `com.apple.SimulatorKit`
- gets its `executablePath`
- opens it with `dlopen`
- resolves the requested symbol with `dlsym`
- asserts if the symbol lookup fails

This means the helper is not statically linked against the private SimulatorKit/HID entrypoints. It resolves them dynamically from the installed Xcode simulator frameworks at runtime.

#### Input and control message paths

- `setUpKeyboard`
  - checks whether the simulator client responds to `setHardwareKeyboardEnabled:keyboardType:error:`
  - temporarily enables the hardware keyboard
  - sends two synthetic key events with key code `0`
  - sleeps briefly
  - disables the hardware keyboard again
- `sendKeyEventWithKeyCode:keyDirection:`
  - uses the cached `IndigoHIDMessageForKeyboardArbitrary` entrypoint
  - maps Radon direction into the simulator’s expected direction code
    - non-`1` -> `1`
    - `1` -> `2`
  - forwards the generated message through `sendIndigoMessage:ofSize:`
- `sendButtonEventWithKeyCode:keyDirection:`
  - uses the cached `IndigoHIDMessageForButton` entrypoint
  - maps direction the same way as keyboard:
    - non-`1` -> `1`
    - `1` -> `2`
  - passes a literal extra argument `0x33` when building the message
  - forwards through `sendIndigoMessage:ofSize:`
- `sendTouchAt:secondTouchAt:type:`
  - maps helper touch type to simulator direction values:
    - `0 -> 1`
    - `1 -> 2`
    - `2 -> 6`
  - builds the native touch payload through `touchMessageForTouchAt:secondTouchAt:direction:`
  - forwards through `sendIndigoMessage:ofSize:`
- `sendIndigoMessage:ofSize:`
  - wraps the raw bytes in `NSData`
  - malloc-copies them again
  - sends them through `_simDeviceClient sendWithMessage:freeWhenDone:completionQueue:completion:`
  - uses the dedicated dispatch queue for completion
- `sendPurpleMessage:`
  - calls `_device lookup:error:` for a named simulator service
  - surrounding strings point strongly to `PurpleWorkspacePort`
  - on success it builds a small Mach message struct and sends it with `_mach_msg_send`
- `rotateWithDirection:`
  - builds a fixed-size `0x58`-byte message
  - writes constants `0x20032` and `0x4`
  - inserts the requested direction value
  - forwards the message through `sendPurpleMessage:`
- `sendPaste:`
  - currently appears to be a stub / no-op in this build based on the recovered method body

Recovered directly from x86_64 disassembly, these methods are now specific enough to treat as implementation guidance rather than just architectural hints:

- `sendKeyEventWithKeyCode:keyDirection:` calls the builder at ivar `+0x20` with `(keyCode, mappedDirection)`
- `sendButtonEventWithKeyCode:keyDirection:` calls the builder at ivar `+0x28` with `(keyCode, mappedDirection, 0x33)`
- `sendTouchAt:secondTouchAt:type:` does not pass the raw helper type through. It normalizes it first into the exact direction code set `1/2/6`
- all three methods call `malloc_size(payload)` before handing the payload to `sendIndigoMessage:ofSize:`

That means the helper is not serializing Indigo messages itself. It relies on Apple/private builders to allocate the payload, then discovers the final byte size from the resulting allocation and forwards it unchanged.

This materially tightens the control model:

- touch, keyboard, and button input use dynamically resolved Indigo HID builders
- rotation uses a Purple Mach-message path, not the Indigo HID path
- the helper is acting as a real native bridge into simulator internals rather than shelling out per event

#### Screen callback registration and frame ingest

`registerSimulatorFrameCallback:` is now partly reconstructed from code.

- it calls an internal helper with:
  - `_device`
  - the caller callback block
  - `_dispatchQueue`
  - literal flag `1`
- that helper:
  - asks the simulator client for `io`
  - enumerates `ioPorts`
  - filters ports by protocol conformance
  - asks each matching port for its `descriptor`
  - filters descriptors by protocol conformance
  - calls `enumerateScreensWithCompletionQueue:completionHandler:`
  - for each screen, reads `screenProperties.screenID`
  - matches that against a stored target screen ID
  - then calls `registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:`

Recovered protocol identities from Objective-C metadata:

- the `ioPorts` objects conform to `SimDeviceIOPortInterface`
- that protocol exposes:
  - `descriptor`
  - `uuid`
  - `ioPortClass`
- the screen-capable descriptor path is `SimScreenAdapter`
- that protocol exposes:
  - `enumerateScreensMatching:completionQueue:completionHandler:`
  - `enumerateScreensWithCompletionQueue:completionHandler:`
  - `registerScreenAdapterCallbacksWithUUID:callbackQueue:screenConnectedCallback:screenWillDisconnectCallback:`
  - `unregisterScreenAdapterCallbacksWithUUID:`
  - `createScreenWithProperties:currentMode:pixelSize:carPlayProperties:completionQueue:completionHandler:`
  - `removeScreenWithID:completionQueue:completionHandler:`
  - `creatableScreenProperties`

So the iOS callback path is no longer just “some private screen protocol.” The helper is navigating concrete SimulatorKit interfaces:

1. `SimDeviceIOPortInterface`
2. its `descriptor`
3. a `SimScreenAdapter`
4. screen enumeration and callback registration on that adapter

Two of the callback helpers are now understood:

- one callback path receives an `IOSurface`, then calls `CVPixelBufferCreateWithIOSurface`, then forwards the resulting `CVPixelBuffer` into the stored callback and releases it
- another callback path updates the tracked surface pointer first, then also calls `CVPixelBufferCreateWithIOSurface` and forwards the `CVPixelBuffer`

Recovered direct-call implication from `0x1003358a0`:

- `registerSimulatorFrameCallback:` itself is only a thin wrapper
- the actual frame discovery / registration logic lives in a separate native routine identified by symbols as `listAndCaptureScreen`
- arguments passed from `SimulatorControl` are:
  - current `SimDevice` (`ivar +0x8`)
  - hard-coded mode flag `1`
  - caller-supplied callback block
  - dispatch queue (`ivar +0x30`)

So the real frame path boundary is:

1. `SimulatorControl.registerSimulatorFrameCallback:`
2. `listAndCaptureScreen(device, 1, callback, dispatchQueue)`
3. lower-level SimulatorKit enumeration / callback registration

Recovered from direct `lldb` disassembly of `listAndCaptureScreen` itself:

- it begins from `device.io`
- iterates `io.ioPorts` with Objective-C fast enumeration
- rejects ports that do not conform to the expected device-I/O-port protocol
- calls `descriptor` on each surviving port
- rejects descriptors that do not conform to the screen-adapter protocol
- calls `enumerateScreensWithCompletionQueue:completionHandler:` on the surviving descriptor
- inside the screen enumeration callback:
  - calls `screenProperties`
  - then `screenID`
  - compares that integer against the target screen ID stored in the capture context at offset `+0x30`
  - only on match does it proceed to register callbacks
- the actual callback registration helper then:
  - allocates a fresh UUID via `NSUUID UUID`
  - builds three blocks
  - calls `registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:`

This is a stronger recovered contract than the earlier general description. The helper is not subscribing to “whatever screen exists”; it matches a specific numeric `screenID` before registering callbacks.

This is direct evidence that the iOS preview ingest path is:

1. SimulatorKit screen callback
2. `IOSurface`
3. `CVPixelBuffer`
4. Radon-native media pipeline

One practical implication for our Swift helper: if we simply take the first enumerated screen proxy and start polling it, we may miss the actual Radon behavior. The shipped helper keeps an explicit target-screen identity in its capture context and gates callback registration on `screenProperties.screenID` equality.

#### Port-validation findings against the recovered iOS path

The local Swift helper was then brought into alignment with the recovered behavior and exercised against a real booted simulator. The important findings were:

- boot validation had to use primitive `state == 3`, not an Objective-C object read of `stateString`
- device lookup had to use `availableDevices`, not `devices`
- on this host, resolving a `SimDevice` once and then waiting was not sufficient; re-resolving the device from `availableDevices` during the boot wait loop was necessary to avoid a stale object that still reported `Shutdown`
- `screenID` also had to be treated as a primitive integer return, not an Objective-C object payload

Once those alignments were made, the local helper reached:

- `ready <udid>`
- `stream_ready http://127.0.0.1:<port>/stream.mjpeg`

with a real selected screen ID of `1`.

This is important because it upgrades the iOS path from “architecturally plausible” to “locally reproduced enough to emit a live MJPEG stream through the same private-framework shape.”

### iOS simulator backend: stricter recovered method contracts

The direct `lldb` disassembly closes several remaining gaps that were previously still phrased as “strong inference”.

#### `rotateWithDirection:` is a fixed Purple workspace message

Method body at `0x100336010`:

- zeroes a stack buffer of size `0x58`
- writes `0x20032` at offset `0x18` in the local message struct
- writes `0x4` at offset `0x48`
- writes the requested direction integer at offset `0x4c`
- calls `sendPurpleMessage:` with that buffer

Combined with `sendPurpleMessage:` at `0x100335f30`, the recovered behavior is:

- service lookup is `_device lookup:error:@"PurpleWorkspacePort"`
- on success it constructs a small Mach message header around the looked-up port
- recovered message fields include:
  - message ID `0x13`
  - size/length field `0x6c`
  - trailer/aux field `0x7b`
  - remote port = lookup result
- then sends with `mach_msg_send`

So rotation is now best described as:

- a fixed Purple workspace message template

#### Port alignment: current iOS helper rotate path

The local Swift helper now mirrors the recovered native rotate path directly:

- allocates a `0x58`-byte message buffer
- writes:
  - `0x13` at offset `0x0`
  - `0x6c` at offset `0x4`
  - looked-up `PurpleWorkspacePort` at offset `0x8`
  - `0` at offsets `0xc` and `0x10`
  - `0x7b` at offset `0x14`
  - `0x20032` at offset `0x18`
  - `0x4` at offset `0x48`
  - requested direction at offset `0x4c`
- sends the full buffer with `mach_msg_send`

Current helper mapping is:

- `Portrait -> 1`
- `PortraitUpsideDown -> 2`
- `LandscapeLeft -> 3`
- `LandscapeRight -> 4`

This mapping is not just guessed from generic iOS enums. It is the current best implementation mapping based on:

- the recovered fixed Purple message path in the shipped helper
- the extension-side translation table where:
  - `UIInterfaceOrientationPortrait -> Portrait`
  - `UIInterfaceOrientationPortraitUpsideDown -> PortraitUpsideDown`
  - `UIInterfaceOrientationLandscapeLeft -> LandscapeRight`
  - `UIInterfaceOrientationLandscapeRight -> LandscapeLeft`

The remaining gap is live end-to-end confirmation of the rotation effect on this machine. Repeated rotate probes hit a private-service lifecycle flake where `simctl` still reports the simulator as `Booted`, but the private `SimDevice` resolved through `SimServiceContext` intermittently reverts to `state == 1 / Shutdown` during helper startup. So the rotate implementation is now aligned to the recovered native contract, but runtime validation is still blocked intermittently by simulator-service state inconsistency rather than by the message layout itself.
- with one variable field: the requested direction value

#### Input builder behavior is now concrete enough to mirror

Recovered direct method-body behavior:

- keyboard:
  - builder pointer comes from ivar `+0x20`
  - direction maps into `1` or `2`
  - no extra literal tag beyond key code + mapped direction
- button:
  - builder pointer comes from ivar `+0x28`
  - same direction mapping as keyboard
  - adds literal message-class argument `0x33`
- touch:
  - public method first maps helper touch type into simulator direction `1/2/6`
  - then calls `touchMessageForTouchAt:secondTouchAt:direction:`
  - that lower helper uses the cached mouse Indigo builder from ivar `+0x18`

In all three cases the generated payload is treated as an opaque Indigo allocation:

1. call builder
2. if non-null, compute `malloc_size(payload)`
3. forward bytes + computed size to `sendIndigoMessage:ofSize:`

That means a faithful port does not need to reverse the Indigo payload byte layout if it can call the same private builders. The recovered contract that matters is the builder selection, the argument mapping, and the forwarding path.

#### Native encoder pipeline behind iOS preview/video

The helper creates two separate encoder objects off the same frame flow:

- one allocator creates a `0x28`-byte object that stores:
  - callback pointer at `+0x0`
  - `VTCompressionSessionRef` at `+0x8`
  - width at `+0x10`
  - height at `+0x18`
  - callback context at `+0x20`
- another allocator creates a `0x20`-byte object that stores:
  - callback pointer at `+0x0`
  - `VTCompressionSessionRef` at `+0x8`
  - first-frame / timebase-related timestamp state at `+0x10`
  - callback context at `+0x18`

Recovered encoder behavior:

- the first encoder creates a VideoToolbox compression session with codec fourcc `jpeg`
- it sets `RealTime = true`
- it sets `Quality`
- it sets pixel transfer properties including `DestinationYCbCrMatrix = ITU_R_601_4`
- it then encodes each incoming `CVPixelBuffer`

- the second encoder creates a VideoToolbox compression session with codec fourcc `avc1`
- it initializes mach timebase info once
- it computes a `CMTime` from `mach_absolute_time`
- it sets:
  - `RealTime = true`
  - `ProfileLevel = H264_Main_AutoLevel`
  - `AllowFrameReordering = false`
  - `MaxKeyFrameIntervalDuration`
  - pixel transfer `ScalingMode = Letterbox`
- its sample-buffer callback:
  - checks whether the frame is sync / keyframe
  - pulls SPS/PPS from the format description on sync frames
  - prepends Annex B start codes
  - reads the encoded AVCC block buffer
  - byte-swaps NAL lengths to host order
  - rewrites them back out as Annex B start-code-delimited NAL units
  - forwards `bytes`, `length`, `width`, `height`, and `isKeyframe` into the stored callback

This is an important fidelity result. The helper does not have a single “preview image path.” It maintains a parallel native JPEG path and a parallel native H.264 path from the same simulator frames.

What can be said safely from current evidence:

- the live preview server is definitely MJPEG-backed, because the binary exposes `/stream.mjpeg`, `multipart/x-mixed-replace`, and `Content-Type:image/jpeg`
- the JPEG encoder is therefore strongly associated with the live preview path
- the H.264 path is definitely real and fully implemented, but its exact consumers inside Radon still need correlation before claiming whether it is used only for recording/replay, for secondary transport, or for additional tooling paths
- one recovered fanout call site conditionally invokes the H.264 encoder and then unconditionally invokes the JPEG encoder on the same source frame
- that supports, but does not yet fully prove, the model that JPEG is the always-on preview path while H.264 is attached only when an additional sink is active

This is especially valuable because it narrows the iOS architecture much further than before:

- there is a concrete simulator-control object, not just free functions
- it holds both a `SimDevice` and a `SimDeviceLegacyClient`
- it caches function pointers/callable bridges for mouse, keyboard, and button message creation
- it performs work on an internal dispatch queue rather than fully synchronous shell-style calls
- it dynamically loads private simulator frameworks from Xcode
- it registers screen callbacks against simulator IO ports
- it converts simulator `IOSurface` frames into `CVPixelBuffer`s
- it fans those frames out into native JPEG and H.264 encoder pipelines
- it uses Indigo for HID-style input and Purple/Mach messages for at least rotation

#### Shared media utilities that must not be over-attributed to iOS

The helper also contains a more generic native media layer under `src/media_handler.rs` and related modules. Some of it is used by iOS flows, but not all of it is iOS-specific.

Recovered source/module anchors from strings:

- `src/device_controller/ios.rs`
- `src/media_handler.rs`
- `src/mjpeg_server.rs`
- `src/device_controller/android_device/video.rs`
- `simulator_server::media_handler::screenshot`
- `simulator_server::media_handler::muxer::rotator`

Important boundary correction:

- the recovered H.264 decode path at `0x100337370` is called from `src/device_controller/android_device/video.rs`
- that means strings like `Received decoded H264 frame ... (frame: ..., rotation: ...)` are evidence for the Android physical-device video path, not for the iOS simulator backend

Recovered shared media helpers:

- `0x100338330`
  - creates or reuses pooled `CVPixelBuffer` outputs with configurable width/height
- `0x100338c70`
  - clones a BGRA `CVPixelBuffer` by allocating a new buffer and `memcpy`ing the full image payload
- `0x100338890`
  - validates rotation degrees
  - swaps output width/height for quarter-turn rotations
  - maps degrees to `vImageRotate90_ARGB8888` rotation codes
  - rotates into a pooled output buffer
  - but no direct call site has yet been recovered, so this remains a shared available primitive rather than proven iOS live-preview behavior
- `0x100337370`
  - parses Annex B H.264
  - extracts/caches SPS and PPS
  - rebuilds the format description if needed
  - recreates the decompression session when parameters change
  - decodes through VideoToolbox
  - this path is currently attributable to Android physical-device video, not iOS

Recovered rotation helper behavior:

- accepted rotations are degree-like values corresponding to `90`, `180`, and `270`
- quarter-turn detection is handled separately from half-turn detection
- the rotation-code mapper produces:
  - `90` or `-270` -> `3`
  - `180` or `-180` -> `2`
  - `-90` or `270` -> `1`
  - everything else -> `0`

This strongly suggests a shared clockwise/counterclockwise normalization layer over `vImageRotate90_ARGB8888`, but until a direct iOS call site is recovered it should be treated as a shared utility, not a confirmed iOS preview step.

#### Screenshot and clipboard export path

The clipboard export path is now also concrete.

Recovered native flow:

- raw image bytes -> `CGDataProviderCreateWithData`
- `CGColorSpaceCreateDeviceRGB`
- `CGImageCreate`
- `NSImage alloc/initWithCGImage:size:`
- `NSPasteboard generalPasteboard`
- `clearContents`
- `NSArray initWithObjects:count:`
- `writeObjects:`

This path emits `copy_screenshot_error ...` on failure and logs from `src/media_handler.rs`, which matches the higher-level JS observation that clipboard copy is a separate follow-up step after screenshot save.

#### Media-flow consumer mapping is now materially tighter

The native helper now gives a much stronger picture of how simulator frames fan out.

Recovered from the x86_64 helper at the fanout site around `0x100044f...0x10004512a`:

- one branch conditionally calls `0x1003367b0`
- the same frame is then unconditionally sent to `0x100336400`
- a third branch can clone the frame with `0x100338c70` and then iterate a sink list through `0x100338e10`

By the already recovered function identities:

- `0x1003367b0` is the native H.264 encoder path
- `0x100336400` is the native JPEG encoder path
- `0x100338c70` is the BGRA pixel-buffer clone helper

That gives a much stronger evidence-based mapping:

- live preview:
  - strongly confirmed as JPEG-backed MJPEG
  - evidence:
    - `/stream.mjpeg`
    - `multipart/x-mixed-replace`
    - `Content-Type:image/jpeg`
    - the JPEG encoder sits on the unconditional fanout path
- screenshot export:
  - strongly confirmed as using the cloned BGRA image path, not the H.264 decode/encode path
  - evidence:
    - `src/media_handler.rs`
    - direct screenshot export consumers call `0x100338c70`
    - helper strings expose:
      - `Screenshot exported to`
      - `screenshot_ready`
      - `no image to export`
- clipboard copy of last screenshot:
  - strongly confirmed as another cloned-image consumer layered on top of the saved screenshot path
  - evidence:
    - `copy_screenshot_error`
    - pasteboard/`NSImage` path recovered from native code
- H.264:
  - strongly confirmed as a real active sink
  - no longer just "implemented but maybe unused"
  - but still not fully attributable to one exact high-level feature name
  - the safest current statement is:
    - H.264 is an optional downstream media sink
    - JPEG is the unconditional preview sink
    - cloned BGRA frames feed at least one additional export/processing path
  - the mux/export ownership is now much stronger because:
    - `Video exported to ...` comes from `src/media_handler/muxer.rs`
    - the helper emits `video_ready ...` from that same muxer/export path
    - after export, the muxer can hand off to `src/media_handler/muxer/rotator.rs` to apply rotation to the saved video file

Strongest current inference:

- recording/replay export is very likely the feature family behind the optional H.264 sink
- but the exact callback-to-muxer handoff is still not linearly recovered instruction-by-instruction

This is an important refinement. The helper does not appear to have a single "preview frame pipeline." It has at least:

- an unconditional JPEG/MJPEG preview path
- an optional H.264 path
- an additional cloned-image path used by export/processing flows

What still remains unresolved is the exact semantic ownership of that H.264 sink:

- whether it is used only for video export
- whether it also feeds replay-specific muxing
- whether additional internal tooling paths consume it

#### H.264 callback-to-sink handoff is now tighter, and the bridge mapping needed one correction

Recovered from the x86_64 helper around `0x100041fd0`, `0x100041900`, `0x100041cf0`, `0x1003362e0`, `0x100336370`, `0x1003367b0`, and `0x100336b40`, plus helper strings:

- the helper leaks the bridge names directly:
  - `H264EncoderBridge`
  - `JpegEncoderBridge`
- the earlier constructor mapping was backwards
- the corrected mapping is:
  - `0x1003362e0` -> `JpegEncoderBridge`
  - `0x100336370` -> `H264EncoderBridge`

The strongest evidence for that correction is the worker setup in `src/media_handler/encoder.rs` around `0x100041fd0`:

- the worker pulls two downstream objects from its state:
  - `+0x198`
  - `+0x1a0`
- it then constructs two bridges:
  - `0x1003362e0`
  - `0x100336370`
- after `0x1003362e0`, it stores a heap cell at bridge offset `+0x20`
- after `0x100336370`, it stores a heap cell at bridge offset `+0x18`

Those callback-cell offsets line up with the two recovered callback targets:

- `0x100041cf0`
  - uses `CMBlockBufferGetDataPointer` through `0x100336f40`
  - updates a latest-image style downstream object around offsets `+0x138 .. +0x158`
  - that matches the JPEG path, not the H.264 packet path
- `0x100041900`
  - logs `Received H264 frame with size ...`
  - copies encoded bytes into owned storage
  - packages a `0x38`-byte owned-storage object for the encoded payload
  - then enqueues that owned payload together with:
    - two scalar callback parameters that line up with the encode-side width/height context
    - a trailing one-byte keyframe flag
  - then dereferences the object stored through bridge offset `+0x18` and enqueues that packet into a queue-backed downstream sink

So the bridge/callback ownership is now much sharper:

- `JpegEncoderBridge`
  - is the bridge returned by `0x1003362e0`
  - uses callback target `0x100041cf0`
  - feeds a latest-image style downstream consumer
- `H264EncoderBridge`
  - is the bridge returned by `0x100336370`
  - uses callback target `0x100041900`
  - feeds a queue-backed encoded-packet downstream consumer through bridge offset `+0x18`

The H.264 encode path itself is still the same recovered VideoToolbox pipeline:

- `0x1003367b0` is the active per-frame H.264 encode path
- it lazily creates a `VTCompressionSession` if the encoder object does not already hold one
- the recovered VideoToolbox setup includes:
  - codec `avc1`
  - `RealTime`
  - `ProfileLevel = H264_Main_AutoLevel`
  - `AllowFrameReordering = false`
  - `MaxKeyFrameIntervalDuration`
  - `ScalingMode = Letterbox`
- it then submits the frame with `VTCompressionSessionEncodeFrame`

The encode callback at `0x100336b40` is also still solid:

- it checks that the `CMSampleBuffer` is ready
- it identifies keyframes using `kCMSampleAttachmentKey_NotSync`
- it obtains the `CMVideoFormatDescription`
- on keyframes, it fetches SPS/PPS with `CMVideoFormatDescriptionGetH264ParameterSetAtIndex`
- it then builds an `NSMutableData` payload in **Annex B** form:
  - SPS/PPS prepended on keyframes
  - AVCC NAL units converted by reading lengths, byte-swapping them, and prefixing each one with an Annex-B start code

Most importantly, the H.264 callback does **not** write directly to the MJPEG server or to a simple file handle. After building the Annex-B payload, it forwards it into the downstream object hung off `H264EncoderBridge + 0x18`.

That downstream object is now better characterized too:

- `0x100041900` enqueues into a queue structure rooted around:
  - slots under `+0x80`
  - queue state at `+0x1c0`
  - notification/wakeup state at `+0x100 / +0x110`
- that queue shape matches other media-handler-side packet queues in the helper
- the recovered media-handler string block at `0x1003a634c` groups:
  - `Starting media handler`
  - `Encoder channel closed, stopping media handler`
  - `Media command sender has been dropped, stopping media handler`
  - `Failed to send decoded H264 frame - receiver dropped`
  - `Received JPEG frame`
  under the `simulator_server::media_handler` namespace

The safest exact statement is therefore:

- the final downstream object attached to `H264EncoderBridge` is not a direct file writer
- it is not the MJPEG preview sink
- it is the **producer side of the media handler's encoded-video / encoder-channel ingress**
- the project-visible outer sender type is now recoverable as Tokio `UnboundedSender` machinery
- the remaining stripped part is the exact local message specialization carried through that sender

This also helps separate encoded and decoded H.264 responsibilities:

- encoded H.264:
  - originates at `H264EncoderBridge`
  - is packetized by `0x100041900`
  - is handed into the media handler's encoder-side channel
- decoded H.264:
  - appears in `src/media_handler/decoder/video_toolbox.rs`
  - logs `Received decoded H264 frame ...`
  - uses a different queue shape/consumer path
  - is the side that later surfaces the `Failed to send decoded H264 frame - receiver dropped` failure

`frame_storage` also remains separate and should not be conflated with the immediate H.264 bridge sink:

- the helper names `simulator_server::media_handler::frame_storage`
- `src/media_handler/frame_storage.rs` handles frame-file lifecycle, including `.h264`-named material and cleanup paths
- but the direct instruction-level handoff from the encoded H.264 bridge queue into a specific `frame_storage` object is still not linearly recovered

There is also a smaller callback-style helper on the JPEG side, which still strengthens the broader architecture pattern:

- JPEG and H.264 are both produced by native encoder objects
- each encoder forwards completed output through a callback/sink boundary
- the preview/media subsystem is therefore a **fanout into multiple downstream consumers**, not one monolithic "write frame here" routine

#### The concrete outer H.264 sender type is now recoverable: Tokio `UnboundedSender`

Recovered by matching the helper's x86_64 send/drop paths against the exact Tokio `1.43.0` source files whose paths are embedded in the binary:

- `tokio-1.43.0/src/sync/mpsc/unbounded.rs`
- `tokio-1.43.0/src/sync/mpsc/chan.rs`
- `tokio-1.43.0/src/sync/mpsc/list.rs`
- `tokio-1.43.0/src/sync/mpsc/block.rs`

The match is structural, not superficial:

- in the H.264 callback at `0x100041900`, the object loaded from `H264EncoderBridge + 0x18` is dereferenced once and then treated like a channel inner
- the atomic sequence on `+0x1c0` matches Tokio `UnboundedSender::inc_num_messages()`:
  - low bit checked for closed state
  - `usize::MAX ^ 1` overflow guard
  - `compare_exchange(curr, curr + 2, ...)`
- the queue push at `+0x80 / +0x88` via `0x1000fb800` matches Tokio `list::Tx<T>::push()` / `find_block()`:
  - `BLOCK_CAP = 32`
  - `0x420`-byte queue blocks for the `T = 0x20` specialization in this path
  - linked-block growth and tail-advance logic match the Tokio source
- the wakeup path at `+0x100 / +0x110` matches the `AtomicWaker` / `wake_rx()` side of Tokio `chan.rs`
- the sender-drop path around `0x1000ddaf0` matches Tokio sender semantics:
  - decrement sender count at `+0x1c8`
  - close the list when the last sender goes away
  - wake the receiver

The strongest evidence-backed statement is therefore:

- the boxed object stored through `H264EncoderBridge + 0x18` is using Tokio `UnboundedSender` machinery
- after inlining/optimization, the helper code operates directly on the inner `tokio::sync::mpsc::chan::Chan<T, tokio::sync::mpsc::unbounded::Semaphore>` allocation
- the exact surviving project-level source type is best described as `tokio::sync::mpsc::UnboundedSender<T>` with a stripped local `T`

What is still not fully recoverable from the stripped binary is the local message type parameter `T`.

Recovered shape of that `T` specialization from the send path:

- slot size is `0x20`
- field `+0x0` is a pointer to the owned encoded-payload object
- fields `+0x8` and `+0x10` are scalar callback parameters used like dimensions in the encode path
- field `+0x18` is a one-byte keyframe flag

So the exact message name is still stripped, but the outer queue owner is no longer unresolved: it is Tokio unbounded-MPSC sender machinery, not a Radon-specific queue type.

#### Export-video rotation is now much clearer, and it is not the same thing as the pixel-buffer rotator

Recovered from `src/media_handler/muxer.rs` and adjacent `src/media_handler/muxer/rotator.rs` sites:

- after the muxer export path, the helper logs:
  - `Video exported to ...`
- it then emits:
  - `video_ready <id> <url> <fileUrl>`
- if a non-default rotation is requested, it logs:
  - `Applying rotation ... to the video file`
- the following code immediately:
  - allocates a large heap buffer
  - seeks to the start of the exported file
  - enters a `src/media_handler/muxer/rotator.rs` path with:
    - `Searching for pattern in file, iteration ...`

That is strong evidence that exported-video rotation in this helper is a **file-level postprocess** over the muxed output, not simply a reuse of the in-memory `CVPixelBuffer` rotation primitive.

This is important because there are now two different "rotation" mechanisms in play:

- the shared in-memory pixel-buffer rotator around `0x100338890`
- the muxer/video-file rotator in `src/media_handler/muxer/rotator.rs`

Those should not be conflated when reimplementing export behavior.

#### Shared rotator utility: direct consumers are now recovered

The earlier "no direct consumer recovered" conclusion was too weak. The global disassembly search had been anchored to the nearby helper at `0x100338890`, but the active callable wrapper is the adjacent function at `0x100338900`.

Recovered from x86_64 helper disassembly:

- `0x100338900` is a direct in-memory `CVPixelBuffer` rotation wrapper
- it validates the requested rotation
- allocates a destination pixel buffer
- maps degree-style rotations to `vImageRotate90_ARGB8888`
- swaps width/height for quarter turns

Direct call sites into `0x100338900` are now recovered:

- `src/device_controller/android_emulator.rs`
  - direct call at `0x10002e75a`
  - path clones a pixel buffer, rotates it for emulator orientation, then enqueues the rotated frame onward
- `src/media_handler/decoder/video_toolbox.rs`
  - direct calls at `0x1000415f2` and `0x1000417b8`
  - this is the decoded-video path
  - nearby recovered log/error strings include:
    - `Received decoded H264 frame ...`
    - `Failed to rotate image: ..., dropping it`
- `src/media_handler.rs`
  - direct calls at `0x10010bc32` and `0x10010ce62`
  - this path sits next to recovered `copy_screenshot_error` logging and pasteboard/`NSImage` clipboard code
  - the safest statement is that the rotator is directly exercised by a media-handler screenshot/clipboard handling flow in this build

So the exact state is now:

- the shared in-memory rotator is definitely live and directly used
- it is **not** just a dead helper or purely theoretical primitive
- the recovered direct consumers are Android-emulator frame handling, decoded-video handling, and a screenshot/clipboard media-handler path
- what still remains unrecovered is a direct iOS live-preview frame path into this rotator

The muxer evidence still matters too:

- exported video rotation is separately accounted for by the file-level `muxer/rotator.rs` path
- so the in-memory rotator and the exported-video rotator are two distinct mechanisms and should still not be conflated

Remaining iOS unknowns are now narrower:

- the exact high-level feature ownership of the optional H.264 sink inside media/export flows
- the exact local message specialization carried by the Tokio `UnboundedSender` attached to `H264EncoderBridge`
- whether there is a direct iOS live-preview frame path into the in-memory pixel-buffer rotator
- whether `sendPaste:` is intentionally stubbed or conditionally compiled out in this build

### Android physical-device bootstrap is now clearer: tiny dex wrapper, large native core

The packaged `screen-sharing-agent.jar` contains:

- `classes.dex`
- `classes2.dex`
- `classes3.dex`
- `classes4.dex`
- `classes5.dex`
- `classes6.dex`
- native `.so` per ABI

Observed from dex string surfaces:

- `classes.dex`
  - essentially only resource/build metadata
- `classes2.dex`
  - device-state binder types
- `classes3.dex`
  - `IRotationWatcher`
- `classes4.dex`
  - XR simulated input interfaces
- `classes6.dex`
  - the meaningful Java bootstrap classes:
    - `com/android/tools/screensharing/Main`
    - `ClipboardAdapter`
    - `ClipboardListener`
    - `CodecInfo`
    - `DeviceStateManagerCallback`
    - `DisplayListener`
    - `RotationWatcher`
    - `ServiceManager`
    - `ThrowableHelper`
    - `XrSimulatedInputStateCallback`
  - plus:
    - `nativeMain`
    - `/data/local/tmp/.studio/libscreen-sharing-agent.so`

Practical interpretation:

- Java is mostly bootstrap/service-adapter glue
- binder/listener plumbing is split across the small dex files
- the real protocol, video, and control behavior still lives in the native `.so`

That strengthens the earlier conclusion that native decompilation is not optional for physical-device parity.

### Android physical-device native library leaks a substantial controller API even without a true decompilation pass

The native `libscreen-sharing-agent.so` string surface is now strong enough to move beyond "there are some message names."

Recovered protocol substrate:

- `Base128InputStream`
  - `ReadByte`
  - `ReadBytes`
  - `ReadInt16`
  - `ReadInt32`
  - `ReadInt64`
  - `ReadUInt16`
  - `ReadUInt32`
  - `ReadBool`
  - `ReadFloat`
  - `ReadFixed32`
  - `ReadString16`
- `Base128OutputStream`
  - `WriteByte`
  - `WriteBytes`
  - `WriteInt32`
  - `WriteUInt16`
  - `WriteUInt32`
  - `WriteUInt64`
  - `WriteBool`
  - `WriteFloat`
  - `WriteFixed32`
  - `Flush`

Recovered message model:

- `ControlMessage::Deserialize(...)`
- `ControlMessage::Serialize(...)`
- typed inbound messages:
  - `MotionEventMessage`
  - `KeyEventMessage`
  - `TextInputMessage`
  - `SetDeviceOrientationMessage`
  - `SetMaxVideoResolutionMessage`
  - `StartVideoStreamMessage`
  - `StopVideoStreamMessage`
  - `StartAudioStreamMessage`
  - `StopAudioStreamMessage`
  - `StartClipboardSyncMessage`
  - `StopClipboardSyncMessage`
  - `RequestDeviceStateMessage`
  - `DisplayConfigurationRequest`
  - XR message families
- typed outbound messages / notifications:
  - `ErrorResponse`
  - `DisplayConfigurationResponse`
  - `ClipboardChangedNotification`
  - `SupportedDeviceStatesNotification`
  - `DeviceStateNotification`
  - `DisplayAddedOrChangedNotification`
  - `DisplayRemovedNotification`
  - `UiSettingsResponse`
  - `UiSettingsChangeResponse`

Recovered controller verbs:

- `Controller::ProcessMessage`
- `Controller::ProcessMotionEvent`
- `Controller::ProcessKeyboardEvent`
- `Controller::ProcessTextInput`
- `Controller::ProcessSetDeviceOrientation`
- `Controller::ProcessSetMaxVideoResolution`
- `Controller::StartVideoStream`
- `Controller::StopVideoStream`
- `Controller::StartClipboardSync`
- `Controller::RequestDeviceState`
- `Controller::SendDisplayConfigurations`
- `Controller::SendClipboardChangedNotification`
- `Controller::SendDeviceStateNotification`
- `Controller::SendXrEnvironmentNotification`

Recovered field accessors give useful schema hints:

- `MotionEventMessage`
  - `action()`
  - `display_id()`
  - `is_mouse()`
  - `pointers()`
  - `button_state()`
  - `action_button()`
- `KeyEventMessage`
  - `action()`
  - `keycode()`
  - `meta_state()`
- `TextInputMessage`
  - `text()`
- `SetDeviceOrientationMessage`
  - `orientation()`
- `SetMaxVideoResolutionMessage`
  - `display_id()`
  - `max_video_size()`
- `StartVideoStreamMessage`
  - `display_id()`
  - `max_video_size()`
- `RequestDeviceStateMessage`
  - `state_id()`

This is enough to support a much stronger conclusion:

- the physical-device protocol is not ad hoc
- it is a typed binary protocol with explicit serialization/deserialization and a real controller dispatch layer
- the message schema is likely reconstructable with further native analysis even without source code

### Physical-device backend capabilities are broader than the current panel surface

The native strings also expose concrete UI/device-state operations such as:

- `UiSettings::SetDarkMode`
- `UiSettings::SetFontScale`
- `UiSettings::SetScreenDensity`
- `UiSettings::SetTalkBack`
- `UiSettings::SetSelectToSpeak`
- `UiSettings::SetGestureNavigation`
- `UiSettings::SetDebugLayout`
- `UiSettings::SetAppLanguage`

This reinforces an earlier pattern:

- the backend substrate is richer than what the visible Radon panel currently exposes
- a faithful reimplementation should separate:
  - what the backend can do
  - what the shipped panel chooses to surface

### Android physical-device backend: the controller/display stack is now much clearer

The physical-device backend is no longer just "typed messages plus some JNI." The recovered symbol surface now exposes a fairly concrete control stack.

Recovered host-to-agent message constructors and accessors:

- `StartVideoStreamMessage(int display_id, Size max_video_size)`
- `StopVideoStreamMessage(int display_id)`
- `StartAudioStreamMessage()`
- `StopAudioStreamMessage()`
- `StartClipboardSyncMessage(int max_synced_length, string initial_text)`
- `StopClipboardSyncMessage()`
- `SetDeviceOrientationMessage(int orientation)`
- `SetMaxVideoResolutionMessage(int display_id, Size max_video_size)`
- `RequestDeviceStateMessage(int state_id)`
- `DisplayConfigurationRequest(int)`
- `UiSettingsRequest(int)`
- `ResetUiSettingsRequest(int)`

Important caution:

- those last single-int request constructors are real and recovered
- but the exact semantic meaning of the integer is **not** proven from the symbol name alone in every case
- for example, it may be a target ID, request ID, or another selector field depending on the message family
- so they should be treated as "single-int request messages" unless a stronger call-site recovery proves more

Recovered controller dispatch methods:

- `Controller::ProcessMessage`
- `Controller::ProcessMotionEvent`
- `Controller::ProcessKeyboardEvent`
- `Controller::ProcessTextInput`
- `Controller::ProcessSetDeviceOrientation`
- `Controller::ProcessSetMaxVideoResolution`
- `Controller::StartVideoStream`
- `Controller::StopVideoStream`
- `Controller::StartAudioStream`
- `Controller::StopAudioStream`
- `Controller::StartClipboardSync`
- `Controller::RequestDeviceState`
- `Controller::SendDisplayConfigurations`
- `Controller::SendClipboardChangedNotification`
- `Controller::SendDeviceStateNotification`

Recovered display/video backend pieces:

- `DisplayStreamer::Run`
- `DisplayStreamer::CreateCodec`
- `DisplayStreamer::StartCodecUnlocked`
- `DisplayStreamer::ProcessFramesUntilCodecStopped`
- `DisplayStreamer::ReduceBitRate`
- `DisplayStreamer::DisplayRotationWatcher::OnRotationChanged`
- `DisplayManager::CreateVirtualDisplay`
- `DisplayManager::RequestDisplayPower`
- `SurfaceControl::SetDisplaySurface`
- `SurfaceControl::SetDisplayProjection`
- `SurfaceControl::SetDisplayLayerStack`

Recovered runtime/log strings sharpen how that stack behaves:

- `Display %d: starting video stream`
- `Display %d: creating codec`
- `Display %d: configured %s video size %dx%d bit_rate %d`
- `Display %d: setting video orientation %d`
- `Display %d: video frame #%d produced by the encoder`
- `Display %d: DisplayRotationWatcher::OnRotationChanged: new_rotation=%d old_rotation=%d`
- `DisplayAddedOrChangedNotification(%d, %dx%d, %d, type=%d)`

That supports a much more precise model:

- the physical-device agent is display-scoped, not just "one device stream"
- video start/stop is per display and takes an explicit max resolution
- audio start/stop is a separate control family
- clipboard sync is a separate control family and includes:
  - initial text
  - a host-controlled max synced length
- device orientation/state are separate message families from display video control

There is also a clearer split between controller and agent responsibilities than before:

- `Controller::*` methods decode and route typed control messages
- `Agent::*` methods are separately exposed for:
  - `StartVideoStream(int, Size)`
  - `StopVideoStream(int)`
  - `StartAudioStream()`
  - `StopAudioStream()`

That suggests the controller is not the lowest-level transport owner; it sits above a more direct device/streaming agent layer.

Recovered input/control substrate is also clearer:

- virtual input devices/types exist for:
  - `VirtualKeyboard`
  - `VirtualDpad`
  - `VirtualMouse`
  - `VirtualTablet`
  - `VirtualTouchscreen`
  - `VirtualStylus`
- motion messages carry:
  - `display_id`
  - pointer list
  - `button_state`
  - `action_button`
  - `is_mouse`
- text input is its own typed message family, not key-event emulation
- clipboard get/set is native and explicit, not shell-text shuttling

This means a faithful physical-device reimplementation would need, at minimum:

- a base-128-framed typed control protocol
- per-display video control
- separate audio and clipboard channels/commands
- virtual input-device injection semantics
- device-state notifications and requests
- UI-settings request/change/response plumbing

Recovered response/notification constructor signatures now make parts of the outbound schema more concrete:

- `ClipboardChangedNotification(string)`
- `DeviceStateNotification(int)`
- `DisplayRemovedNotification(int)`
- `DisplayAddedOrChangedNotification(int, Size, int, int)`
- `SupportedDeviceStatesNotification(vector<DeviceState>, int)`
- `UiSettingsResponse(int)`
- `UiSettingsChangeResponse(int)`

Recovered UI-settings factories also show the request payload families explicitly:

- `createDarkModeChangeRequest(int, bool)`
- `createFontScaleChangeRequest(int, int)`
- `createDensityChangeRequest(int, int)`
- `createTalkbackChangeRequest(int, bool)`
- `createSelectToSpeakChangeRequest(int, bool)`
- `createGestureNavigationChangeRequest(int, bool)`
- `createDebugLayoutChangeRequest(int, bool)`
- `createAppLocaleChangeRequest(int, string, string)`

That is enough to say the outbound side is not just "notifications exist." It has real typed response payloads for:

- per-display configuration changes
- device-state changes
- clipboard changes
- UI settings state and UI settings mutations

### Android physical-device protocol: numeric `ControlMessage` dispatch is now recovered

Recovered from `ControlMessage::Deserialize(Base128InputStream&)`, `ControlMessage::Deserialize(int, Base128InputStream&)`, and `Controller::ProcessMessage`:

- the protocol first reads a numeric message type with `Base128InputStream::ReadInt32()`
- dispatch then goes through a jump table on `type - 1`
- `Controller::ProcessMessage` mirrors the same family split on the controller side

Recovered numeric mapping:

- `1` -> `MotionEventMessage`
- `2` -> `KeyEventMessage`
- `3` -> `TextInputMessage`
- `4` -> `SetDeviceOrientationMessage`
- `5` -> `SetMaxVideoResolutionMessage`
- `6` -> `StartVideoStreamMessage`
- `7` -> `StopVideoStreamMessage`
- `8` -> `StartAudioStreamMessage`
- `9` -> `StopAudioStreamMessage`
- `10` -> `StartClipboardSyncMessage`
- `11` -> `StopClipboardSyncMessage`
- `12` -> `RequestDeviceStateMessage`
- `13` -> `XrRotationMessage`
- `14` -> `XrTranslationMessage`
- `15` -> `XrAngularVelocityMessage`
- `16` -> `XrVelocityMessage`
- `17` -> `XrRecenterMessage`
- `18` -> `XrSetPassthroughCoefficientMessage`
- `19` -> `XrSetEnvironmentMessage`
- `20` -> `DisplayConfigurationRequest`
- `21` -> `UiSettingsRequest`
- `22` -> `UiSettingsChangeRequest`
- `23` -> `ResetUiSettingsRequest`

This matters because it moves the physical-device protocol from "named classes exist" to "numeric on-wire message families are directly recoverable."

It also gives a stronger controller model:

- controller dispatch is not heuristic or string-based
- the wire format is a compact numeric protocol over the base-128 framing layer
- XR, display, clipboard, video, audio, device-state, and UI-settings control families all sit in the same primary control-message enum

### Android physical-device protocol: several inbound payload layouts are now concrete

Recovered from per-message deserializers plus field accessors:

#### `KeyEventMessage`

Observed deserialize order:

- `ReadInt32()` -> action
- `ReadInt32()` -> keycode
- `ReadUInt32()` -> meta_state

Accessor offsets confirm:

- `action()` at object offset `0xc`
- `keycode()` at `0x10`
- `meta_state()` at `0x14`

#### `SetDeviceOrientationMessage`

Observed deserialize order:

- `ReadInt32()` -> orientation

#### `SetMaxVideoResolutionMessage`

Observed deserialize order:

- `ReadInt32()` -> display_id
- `ReadInt32()` -> width
- `ReadInt32()` -> height

Recovered constructor/accessor behavior confirms:

- `display_id()` at object offset `0xc`
- `max_video_size()` begins at `0x10`
- width/height are assembled into a `Size`

#### `StartClipboardSyncMessage`

Observed deserialize order:

- `ReadInt32()` -> max_synced_length
- `ReadBytes()` -> initial/seed text payload

Accessor recovery confirms:

- `max_synced_length()` at `0xc`
- `text()` begins at `0x10`

#### `RequestDeviceStateMessage`

Observed deserialize behavior:

- the message reads one `ReadInt32()`
- the recovered code subtracts `1`
- the adjusted value is then stored in `RequestDeviceStateMessage(int state_id)`

This is an important packet-level detail:

- the encoded on-wire integer is **not** passed through verbatim
- there is an explicit `-1` transform before the stored `state_id()`

The safest statement is therefore:

- the message family is proven
- the stored `state_id()` accessor is proven
- the exact higher-level semantic meaning of the encoded value still should not be over-interpreted beyond "wire value is normalized by subtracting 1"

#### `DisplayConfigurationRequest`, `UiSettingsRequest`, `ResetUiSettingsRequest`

Recovered constructor and handler behavior now resolves the meaning of the single integer for this family.

Observed deserialize behavior for each:

- `ReadInt32()`
- immediate construction of the corresponding single-int request object

Recovered constructor/handler chain:

- each of these constructors calls `CorrelatedMessage::CorrelatedMessage(int request_id, int type)`
- `DisplayConfigurationRequest(int)` uses message type `20`
- `UiSettingsRequest(int)` uses message type `21`
- `ResetUiSettingsRequest(int)` uses message type `23`
- the controller-side response paths call `CorrelatedMessage::request_id()` and feed that same integer into:
  - `DisplayConfigurationResponse(request_id, ...)`
  - `UiSettingsResponse(request_id)`

These are therefore no longer semantically ambiguous:

- the single integer in these request messages is the correlation/request ID
- it is used to match request/response pairs, not a hidden display selector or command subtype

#### `UiSettingsChangeRequest`

Recovered on-wire layout:

- first `ReadInt32()` -> leading integer parameter
- second `ReadInt32()` -> change selector
- then a selector-specific payload

Recovered selector mapping:

- `0` -> dark mode, then `ReadBool()`
- `1` -> font scale, then `ReadInt32()`
- `2` -> density, then `ReadInt32()`
- `3` -> talkback, then `ReadBool()`
- `4` -> select-to-speak, then `ReadBool()`
- `5` -> gesture navigation, then `ReadBool()`
- `6` -> debug layout, then `ReadBool()`
- `7` -> app locale, then `ReadBytes()`, `ReadBytes()`

Recovered factory calls line up with that mapping:

- `createDarkModeChangeRequest(int, bool)`
- `createFontScaleChangeRequest(int, int)`
- `createDensityChangeRequest(int, int)`
- `createTalkbackChangeRequest(int, bool)`
- `createSelectToSpeakChangeRequest(int, bool)`
- `createGestureNavigationChangeRequest(int, bool)`
- `createDebugLayoutChangeRequest(int, bool)`
- `createAppLocaleChangeRequest(int, string, string)`

Important caution:

- the first integer is definitely real and on-wire
- recovered construction now shows it is also the correlation/request ID:
  - `UiSettingsChangeRequest::UiSettingsChangeRequest(int, UiCommand)` calls `CorrelatedMessage::CorrelatedMessage(int request_id, int type)` with type `22`
- the second integer is the real change selector
- so the remaining semantic work is in selector payload values, not in the leading integer

#### `MotionEventMessage`

Recovered deserialize layout:

- `ReadUInt32()` -> pointer count
- per pointer:
  - `ReadInt32()`
  - `ReadInt32()`
  - `ReadInt32()`
  - `ReadUInt32()` -> nested value count
  - repeated nested values:
    - `ReadInt32()`
    - `ReadFloat()`
- trailing scalar fields:
  - `ReadInt32()` -> action
  - `ReadInt32()` -> button_state
  - `ReadInt32()` -> action_button
  - `ReadInt32()` -> display_id
  - `ReadBool()` -> is_mouse

Accessor offsets confirm those trailing scalar identities:

- `action()` at `0x28`
- `button_state()` at `0x2c`
- `action_button()` at `0x30`
- `display_id()` at `0x34`
- `is_mouse()` at `0x38`

This means the protocol shape for motion events is no longer fuzzy:

- it has an explicit pointer array
- each pointer has a nested typed/value sub-array
- then the event carries action/button/display/mouse metadata

Recovered handler behavior from `Controller::ProcessMotionEvent(...)` makes the pointer layout much sharper:

- per-pointer field at offset `0x8` is the `pointer_id`
  - recovered by the call into `PointerHelper::SetPointerId(...)`
- per-pointer fields at offsets `0x0` and `0x4` are raw x/y-style coordinates
  - they are transformed before being passed to `PointerHelper::SetPointerCoords(...)`
- the repeated nested `(int, float)` items are explicit axis/value pairs
  - recovered by iteration that feeds them to `PointerHelper::SetAxisValue(axis_id, axis_value)`
- tool type is not stored separately per pointer in this path
  - the handler derives the message-wide tool type from `is_mouse`
  - recovered mapping:
    - `is_mouse = false` -> touch-style tool type
    - `is_mouse = true` -> mouse-style tool type
- pressure is synthesized in the handler based on action path
  - it is not directly read from a dedicated per-pointer scalar field in the recovered struct layout

So the safest current concrete layout is:

- per pointer:
  - first int: raw x coordinate
  - second int: raw y coordinate
  - third int: pointer ID
  - nested repeated entries: `(axis_id, axis_value)` pairs for pointer coords
- trailing message scalars:
  - action
  - button_state
  - action_button
  - display_id
  - is_mouse

### Replay / recording / export edge cases from extension/helper correlation

The JS/native correlation now exposes several small but important behavior details that matter for parity.

Observed from the extension bundle:

- recording starts with:
  - `video recording start -b 2000`
- replay capture starts with:
  - `video replay start -m -b 50`
- screenshot capture starts with:
  - `screenshot screenshot -r <rotation>`
- screenshot clipboard follow-up uses:
  - `copy_screenshot -r <rotation>`

Observed stop/save ordering:

- recording stop is not just `stop`
- `captureAndStopRecording(rotation)` first issues the save/export request:
  - `video recording save -r <rotation>`
- it then sends:
  - `video recording stop`

This means the extension expects the helper to treat save/export as a distinct asynchronous operation, not as an implicit side effect of stop.

Replay has a particularly non-obvious dual behavior:

- `captureReplay(rotation)` sends:
  - `video replay save -r <rotation> -d 5 -d 10 -d 30`
- the helper emits `video_ready replay ...` / `video_error replay ...`
- the preview layer remaps those to:
  - `replay_ready`
  - `replay_error`
- `saveMultimediaWithID(...)` ignores replay-ready events whose parsed duration is not `"full"`
- `ScreenCapture.updateReplayState(...)` separately collects the short replay artifacts in state
- those replay artifacts are:
  - deduplicated by duration
  - sorted so timed clips come first and `"full"` comes last

So one replay capture request actually has two consumers:

- the promise-returning capture path, which waits for the `"full"` replay artifact
- the stateful replay gallery path, which keeps the timed clips like `5s`, `10s`, and `30s`

Helper/runtime edge cases now directly evidenced by strings and code:

- video export can fail with:
  - `video_error ... no frames to export`
- screenshot export can fail with:
  - `screenshot_error ... no image to export`
- clipboard copy can fail with:
  - `copy_screenshot_error ...`
  - `clipboard_error no image to export`
- decoded-H.264 downstream processing can fail with:
  - `Failed to send decoded H264 frame - receiver dropped`

There is also an asymmetry worth preserving:

- the extension parses structured stdout events for:
  - `video_ready`
  - `video_error`
  - `screenshot_ready`
  - `screenshot_error`
- the extension does **not** appear to parse a dedicated success/failure event family for `copy_screenshot`

So `copy_screenshot` behaves more like a side-effect command with best-effort logging than a first-class promise-backed export job.

### Public docs do still reveal one important preview API boundary

Although the public repo is not the shipped extension source, the docs do confirm one public-facing preview contract:

- users install `radon-ide` into the app project
- they import:
  - `preview` from `radon-ide`
- they call:
  - `preview(<MyComponent ... />)`

The docs also confirm product-level scope:

- Panel Mode is the main embedded preview mode
- Panel Mode is limited to Android emulators and iOS simulators
- physical devices are outside main panel mode and rely on different flows such as physical-device support / Connect Mode

That does not reveal implementation, but it is useful for parity planning because it identifies the public boundary a reimplementation would need to emulate.

## Current Practical Takeaway

At this point:

- no JS decompilation was necessary yet
- the Metro/Babel injection path is the core of the product
- the runtime bridge is heavily based on React DevTools transport concepts
- the network inspector is a multi-backend normalized telemetry system rather than a single hard-coded panel feature
- Radon AI is a hybrid local/remote MCP architecture, not just a cloud chatbot bolt-on
- Connect mode is a deliberately thin debugger auto-attach path, not panel mode with hidden buttons
- the simulator helper presents the extension with a small text command/event protocol while hiding very different native backends behind it
- the Android emulator path looks like a gRPC adapter that re-discovers emulator runtime metadata on its own rather than being handed raw gRPC connection details by the extension
- on the Android emulator path, `wheel` is live-confirmed as repeated `sendMouse` gesture synthesis rather than `injectWheel`, while `rotate` is helper-side license gated in the observed plan before any emulator RPC is made
- on the tested non-resizable AVD, the underlying emulator landscape mechanism is now directly observed as `setPhysicalModel(ROTATION)` on the z-axis, with `+90 -> LANDSCAPE` and `-90 -> REVERSE_LANDSCAPE`
- the Android physical-device path is a much heavier agent architecture, with a custom base-128-framed protocol and an on-device runtime that is overwhelmingly native
- media consumption is now more precise:
  - JPEG is on the unconditional live-preview path
  - screenshot/clipboard flows use cloned BGRA image buffers
  - H.264 is a real optional downstream sink
  - the bridge boundary is now corrected as:
    - `JpegEncoderBridge` from `0x1003362e0`
    - `H264EncoderBridge` from `0x100336370`
  - the immediate downstream owner of encoded H.264 is the media handler's encoder-channel ingress, not the MJPEG path
  - the outer sender type on that ingress is now recoverable as Tokio `UnboundedSender` machinery
  - the remaining unresolved part is the exact local message specialization and the final feature-level consumers beyond that ingress boundary
- `frame_storage` is now clearly a separate named subsystem and should not be conflated with the immediate encoded-H.264 bridge sink
- the shared native rotator is fully decoded as a reusable primitive, and direct consumers are now recovered in Android-emulator frame handling, decoded-video handling, and a media-handler screenshot/clipboard path
- the Android physical-device agent is now clearly a per-display controller with separate video, audio, clipboard, device-state, and UI-settings control families rather than a single monolithic "streaming socket"
- the macOS simulator helper is likely one of the most proprietary / least immediately readable pieces
- the Android streaming layer appears to reuse upstream screen-sharing infrastructure
- the locally available public `radon-ide` repository is docs/issues only, not the extension implementation source for this shipped build
- the preview command vocabulary at the JS/helper boundary is now largely recovered, so the remaining risk is mainly in native backend behavior and media/pipeline fidelity

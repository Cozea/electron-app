# Radon iOS Port TODO

This is the execution checklist for the iOS-first native preview port.

## Phase 1: Electron lane

- [x] Add shared native preview types
- [x] Add `nativePreview` to `ElectronAPI`
- [x] Add preload wiring for `nativePreview:*`
- [x] Add `registerNativePreviewHandlers.ts`
- [x] Add `NativePreviewManager` skeleton
- [x] Wire native preview handler registration into Electron startup
- [ ] Add renderer-side native preview store

## Phase 2: RN runtime port

- [x] Create `native-preview-runtime/`
- [x] Port `runtime.js`
- [x] Port `react_devtools_agent.js`
- [x] Port `inspector_bridge.js`
- [x] Port `preview.js`
- [x] Port minimal `wrapper.js`
- [x] Port minimal `dimensions_observer.js`
- [x] Port minimal `orientation/`
- [x] Port minimal `inspector_availability.js`
- [x] Port `rn-internals` version router and initial RN version files
- [x] Replace temporary no-op tool-plugin fallbacks for `network` and `render_outlines`
- [x] Copy `expo/` and `expo_router/` runtime modules needed by the original transformer

## Phase 3: Metro / Babel integration

- [x] Port minimal `metro_helpers.js`
- [x] Port minimal `babel_transformer.js`
- [x] Port `metro_config.js` and `metro_reporter.js`
- [x] Add Electron-side launch path for RN / Expo native mode
- [ ] Prove runtime injection in a sample RN app

## Phase 4: iOS helper MVP

- [x] Create `native/ios-preview-helper/`
- [x] Implement helper stdin/stdout protocol
- [x] Wire `NativePreviewManager` to spawn the helper and relay protocol commands
- [ ] Implement simulator attach by UDID
- [ ] Implement frame callback registration
- [ ] Implement `IOSurface -> CVPixelBuffer -> JPEG`
- [ ] Implement MJPEG server
- [ ] Implement touch injection
- [ ] Implement key injection
- [ ] Implement button injection
- [ ] Implement rotation
- [ ] Implement screenshot save/copy

## Phase 5: Embedded renderer preview

- [ ] Create native preview store
- [ ] Create iOS simulator viewport component
- [ ] Adapt toolbar shell from current web preview
- [ ] Render MJPEG stream inside the app
- [ ] Normalize pointer coordinates
- [ ] Send input actions through `nativePreview:*`

## Phase 6: Hardening

- [ ] Session reconnect logic
- [ ] Helper crash recovery
- [ ] Stale stream recovery
- [ ] Simulator restart handling
- [ ] Screenshot error paths
- [ ] Typecheck and end-to-end smoke test

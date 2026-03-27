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

- [ ] Create `native-preview-runtime/`
- [ ] Port `runtime.js`
- [ ] Port `react_devtools_agent.js`
- [ ] Port `inspector_bridge.js`
- [ ] Port `preview.js`
- [ ] Port minimal `wrapper.js`
- [ ] Port minimal `dimensions_observer.js`
- [ ] Port minimal `orientation/`

## Phase 3: Metro / Babel integration

- [ ] Port minimal `metro_helpers.js`
- [ ] Port minimal `babel_transformer.js`
- [ ] Add Electron-side launch path for RN / Expo native mode
- [ ] Prove runtime injection in a sample RN app

## Phase 4: iOS helper MVP

- [ ] Create `native/ios-preview-helper/`
- [ ] Implement helper stdin/stdout protocol
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

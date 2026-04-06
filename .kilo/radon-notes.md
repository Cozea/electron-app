# Radon IDE Headless Integration Notes

This document tracks our understanding and reverse engineering of the Radon IDE extension (`radon-ide` VSIX) so we can successfully run it headlessly within our custom Electron application.

## 1. Binary Structure

The core binaries are located in `resources/radon/dist/`:
- `simulator-server-macos`
- `simulator-server-linux`
- `simulator-server-windows.exe`

These binaries act as a bridge between the Electron host, the running iOS/Android emulators, and the React Native runtime.

### CLI Commands
* `fingerprint`: Returns a 64-character hex string representing the machine fingerprint (used to validate the license).
* `verify_token`: Verifies the JWT license token locally.
* `ios`: Runs the iOS simulator controller.
  - `--id <id>`: Target iOS simulator UUID (from `xcrun simctl list`).
  - `-d, --device-set <path>`: Path to custom device set if any.
  - `-t, --license-token <token>`: License JWT token. If not provided, the simulator server will run but will exit automatically after some time.
* `android`: Runs Android emulator controller.
* `android_device`: Runs Android physical device controller.

## 2. Server Event Output
The `simulator-server` binaries output structured logs to `stdout` and debugging info to `stderr`.

**Known stdout events:**
- `stream_ready <url>`: Indicates the MJPEG stream is ready (e.g., `stream_ready http://127.0.0.1:65480/stream.mjpeg`).

**Known stderr events:**
- `[INFO simulator_server::mjpeg_server] MJPEG server started at ...`
- iOS specific: `JPEG encoder initialized`, `H264 encoder initialized`, `Setting simulator keyboard language: en`

## 3. Communication Protocol (stdin)
* The binary accepts commands via `stdin` (e.g., `pointer down`, `rotate 90`).
* Documented in `electron/services/radon/protocol.ts`.

## 4. Known Issues & Fixes

**Issue 1: Simulator Disconnect ("it doesn't work")**
- **Symptom:** The IDE UI boots a simulator and shows a preview, but the React Native app never appears in the preview (shows a blank screen/home screen), while the user's `react-native run-ios` / `expo` opens a *separate* simulator.
- **Root Cause:** The `devicePaths.ts` logic was sandboxing simulators into a custom device set (`~/Library/Application Support/cozea/Devices/iOS`), but Metro/Expo packagers don't know about this path and boot the app in the *default* simulator set.
- **Fix Applied:** Modified `devicePaths.ts` to return `undefined` for `getManagedIosDeviceSetPath()` and `getManagedAndroidDeviceSetPath()`. Updated `AndroidDeviceManager`, `IOSDeviceManager`, and `RadonHostService` to skip passing `--device-set` or `ANDROID_AVD_HOME` if undefined. Also updated `listAvdNames` to use the `emulator -list-avds` command instead of reading files manually from the (now undefined) custom path.

**Issue 2: Zombie Processes Locking the Emulator**
- **Symptom:** The `simulator-server-macos` process stays alive in the background (as a zombie) even after closing the preview or the app. Subsequent preview launches instantly crash because the zombie process holds an exclusive lock on the iOS Simulator's screen buffer.
- **Root Cause:** Sending `process.kill('SIGTERM')` is not enough. The native VS Code extension cleans up by closing the `stdin` stream (`stdin.end()`) which signals the Rust binary to gracefully terminate its screen recording loops.
- **Fix Applied:** In `RadonHostService.ts`, `stopSession` now calls `process.stdin.end()`, follows up with a `SIGTERM`, and sets a 3-second timeout to issue a fatal `SIGKILL` (`kill -9`) if the process hangs. Additionally, added a `dispose()` hook to `app.on('before-quit')` to sweep all running simulators on app exit.

**Issue 3: Unhandled ScreenCapture / CoreSimulator SIGSEGVs**
- **Symptom:** The UI displays a black screen with `PREVIEW STREAM CLOSED UNEXPECTEDLY (SIGSEGV)` when launching an iOS simulator preview.
- **Root Cause:** If the `simulator-server-macos` binary is launched without a valid Radon IDE License token (or the trial period expires), the Rust binary attempts to gracefully exit. However, there is a bug in `v1.16.0` where the shutdown/teardown sequence for the CoreSimulator framebuffer pipeline executes an invalid `_platform_memmove` operation, causing an immediate Segmentation Fault (SIGSEGV).
- **Fix Applied:** 
  1. Handled by the robust error-catching pipeline added to `RadonHostService.ts` which accurately detects the crash and surfaces it in the UI.
  2. To prevent the crash entirely, the user must input a valid Radon License Key in `Settings -> Account`. Once the token is validated, the simulator server does not attempt a trial shutdown and successfully streams the iOS 26+ simulator.

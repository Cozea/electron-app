# Open-Source iOS Simulator Headless Engine Specification
*Compiled: March 2026*

This document serves as the complete, definitive technical blueprint for reverse-engineering and replacing the proprietary `simulator-server-macos` binary (distributed by Software Mansion/Radon IDE) with a custom, open-source Rust implementation.

## 1. Executive Summary
The goal is to build a high-performance, zero-latency headless simulator streaming and control engine. 
Unlike naive approaches that use `ScreenCaptureKit` or macOS mouse simulation (which require the Simulator.app GUI to be visible), this architecture achieves true headlessness by using Rust's C-FFI to dynamically link into Apple's private, undocumented frameworks (`CoreSimulator.framework` and `SimulatorKit.framework`). 

By building this natively, we bypass proprietary paywalls (e.g., Radon IDE's "Free" tier limitations) and fix the underlying iOS 26 memory corruption bugs (`SIGSEGV`) caused by outdated `IOSurface` and `IndigoHID` struct alignments in older binaries.

---

## 2. Dynamic Framework Targets
Apple does not publish headers for these frameworks. Our engine must use `dlopen` and the Objective-C runtime (`objc` crate in Rust) to load them dynamically at runtime.

**Framework Paths:**
*   `/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator`
*   `/Library/Developer/PrivateFrameworks/SimulatorKit.framework/SimulatorKit`
*(Fallback to Xcode's internal `Contents/Developer/Library/...` path if the global symlink is missing).*

---

## 3. The Video Pipeline (Framebuffer Extraction)
To capture the screen at 60 FPS without the Simulator window open, we extract the raw GPU framebuffer (`IOSurface`).

### API Surface (iOS 26)
Apple has moved display rendering to a Swift-mangled Objective-C class inside `SimulatorKit`.
*   **Class:** `SimulatorKit.SimDeviceScreen` (mangled: `_TtC12SimulatorKit15SimDeviceScreen`)
*   **Properties:**
    *   `unmaskedSurface` → Returns `IOSurfaceRef` (raw rectangular pixel buffer).
    *   `maskedSurface` → Returns `IOSurfaceRef` (pixels with dynamic island/notch masking applied).
*   **Event Hooks:**
    *   `- [registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:]`
    *   *Usage:* Instead of polling, we pass an Objective-C block into this method to receive an asynchronous callback precisely when the virtual GPU draws a new frame.

### Encoding & Streaming
1.  **Wrap:** The `IOSurfaceRef` is wrapped into a `CVPixelBuffer` using `CVPixelBufferCreateWithIOSurface()`.
2.  **Encode:** Passed to Apple's hardware `VideoToolbox` framework (specifically `VTCompressionSessionCreate`) configured for `kCMVideoCodecType_JPEG` or `kCMVideoCodecType_H264`. Our reverse-engineering of Radon's logs explicitly confirmed their use of VideoToolbox hardware encoders (`[simulator-server-macos] H264 encoder initialized`, `[simulator-server-macos] JPEG encoder initialized`).
3.  **Serve:** A Rust async HTTP server (`axum` or `hyper`) binds to a local port and serves the frames using the `multipart/x-mixed-replace; boundary=frame` MJPEG standard.

---

## 4. The Input Pipeline (IndigoHID Injection)
To inject pixel-perfect touches and hardware button presses without affecting the user's macOS mouse, we use Apple's internal `IndigoHID` Mach IPC protocol.

### API Surface (iOS 26)
*   **Class:** `SimulatorKit.SimDeviceLegacyHIDClient` (mangled: `_TtC12SimulatorKit24SimDeviceLegacyHIDClient`)
*   **Method:** `- [sendWithMessage:freeWhenDone:completionQueue:completion:]`

### The IndigoMessage Struct Layout (iOS 26)
Through runtime memory dumping, we determined that Apple has expanded the `IndigoMessage` struct to **512 bytes** in iOS 26 to accommodate advanced multi-touch arrays. Our Rust `#[repr(C)]` struct must match this exactly to avoid Kernel Panics (`SIGSEGV`).

**Memory Map (512 bytes total):**
*   **`0x00 - 0x1F` (32 bytes):** `mach_msg_header_t` (Standard macOS IPC header, specifying message size).
*   **`0x20 - 0x23` (4 bytes):** Event Type integer (`0x0B` = `IndigoHIDEventTypeTouch`).
*   **`0x24 - 0x2B` (8 bytes):** Mach absolute time timestamp.
*   **`0x30 - 0x1FF` (464 bytes):** Touch Coordinate Array.
    *   Contains 64-bit IEEE 754 floating-point values representing X and Y coordinates.
    *   Coordinates are normalized as ratios (`0.0` to `1.0`).
    *   Base orientation is strictly `Portrait`.

*Note: There are exported C builder functions in `SimulatorKit` (e.g., `IndigoHIDMessageForMouseNSEvent` and `IndigoHIDMessageForButton`) that can be invoked via `dlsym` to safely construct these structs in memory if manual bit-packing proves fragile.*

---

## 5. Host Communication Protocol (Electron ↔ Rust)
The binary communicates with the Electron host (`RadonHostService.ts`) via line-delimited standard input/output (`\n`).

### Standard Input (Commands)
*   **Touches:** `touch down <x>,<y>` | `touch move <x>,<y>` | `touch up <x>,<y>`
    *   *Note: Electron handles coordinate rotation math before sending. The binary only processes Portrait-relative ratios.*
*   **Buttons:** `button Down <name>` | `button Up <name>` (e.g., `home`, `volumeUp`)
*   **State:** `rotate <Portrait|LandscapeRight|PortraitUpsideDown|LandscapeLeft>` | `pointer show <true|false>`
*   **Media:** `screenshot <id>` | `video recording start` | `video recording save`

### Standard Output (Events)
*   `stream_ready http://127.0.0.1:<port>/stream.mjpeg`
*   `fps_report {"fps": 60, "dropped": 0}`
*   `screenshot_ready <id> <url> <file_path>`
*   `video_ready <id> <url> <file_path>`

*(Unlike the proprietary binary, our custom implementation will be resilient to standard pipes and will not require `node-pty` Pseudo-Terminals to prevent crashing).*

---

## 6. Rust Implementation Stack (Required Crates)
To build this project (`cargo new cozea-sim-engine`), the following Rust crates are required:

1.  **`objc2` & `objc2-foundation`**: For Objective-C message passing (`msg_send!`), block creation, and dynamically interfacing with `SimulatorKit`.
2.  **`libloading`**: For executing `dlopen` and resolving the private C function symbols (like `IndigoHIDMessageForMouseNSEvent`).
3.  **`mach2`**: For managing Mach ports and `mach_msg_header_t` structs.
4.  **`core-foundation` & `core-video`**: For managing `CVPixelBufferRef` and memory allocations.
5.  **`tokio`**: For async event loops (listening to `stdin` and running the HTTP server concurrently).
6.  **`axum`**: To quickly stand up the HTTP streaming endpoint for the MJPEG feed.
7.  **`image` / `turbojpeg`**: For fallback JPEG encoding if Apple's VideoToolbox FFI proves too verbose.

## 7. Architecture & Hardware Compatibility (Apple Silicon vs. Intel)
This architecture is designed to be fully universal and will work on both Apple Silicon (M-Series) and older Intel Macs.

*   **VideoToolbox Abstraction:** Apple designed the `VideoToolbox` framework to completely abstract the underlying hardware. When our Rust binary calls `VTCompressionSessionCreate` on an M1/M2/M3/M4 Mac, macOS automatically routes the encoding to the physical Media Engine silicon. When the exact same code runs on an Intel Mac, macOS automatically routes it to Intel Quick Sync Video (via the integrated GPU or the T2 Security Chip) or the AMD discrete GPU. Both achieve hardware-accelerated 60fps encoding with minimal CPU overhead.
*   **Memory Alignment:** Because both `arm64` (Apple Silicon) and `x86_64` (Intel) are 64-bit architectures, the 512-byte `IndigoMessage` C-struct byte alignment and pointer sizes are identical across both machines. 
*   **Compilation:** The Rust engine must simply be compiled as a Universal Binary (using `cargo build --target aarch64-apple-darwin` and `cargo build --target x86_64-apple-darwin`, then stitching them together using Apple's `lipo` tool) to provide a single drop-in replacement for any macOS user.
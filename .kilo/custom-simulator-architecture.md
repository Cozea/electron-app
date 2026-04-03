# Custom Simulator Server Architecture

## The Naive Approach (Flawed)
Initially, one might consider using public macOS APIs:
*   **Video:** `ScreenCaptureKit` to record the Simulator.app window.
*   **Input:** `CoreGraphics` (CGEvent) to simulate mouse clicks over the window.

**Why this fails:** This requires the `Simulator.app` GUI to be visible on-screen at all times. It breaks headlessness, cannot run in CI, and interferes with the user's actual mouse.

## The Real Architecture (How Software Mansion does it)
Software Mansion (Radon IDE) achieves zero-latency, headless streaming by bypassing the macOS windowing system entirely and hooking directly into Apple's undocumented, private developer frameworks (`CoreSimulator.framework` and `SimulatorKit.framework`).

### 1. The Video Pipeline (Headless Framebuffer Extraction)
Instead of capturing a macOS window, the binary talks directly to the virtualized iOS hardware.
*   **Implementation:** It connects to the `SimDevice` Mach ports and extracts the raw `IOSurface` objects directly from the virtual GPU's framebuffer memory. 
*   **Why it crashed earlier:** Because this relies on deeply undocumented Apple memory structures, when Apple changes the `IOSurface` layout or CoreSimulator XPC protocols in new OS versions (like iOS 26), the binary reads the wrong memory address and suffers a `SIGSEGV` (Segmentation Fault).

### 2. The Input Injection Pipeline (Raw HID Events)
Instead of moving the macOS mouse, the binary injects hardware-level touch events directly into the iOS kernel.
*   **Implementation:** It constructs raw `IOHIDEvent` (Human Interface Device) multi-touch digitizer packets and sends them via XPC/Mach messages directly to the `SimDevice` event queue. This allows pixel-perfect taps and swipes even if the simulator has no GUI window.

## How to build an open-source replacement
Replicating this requires reverse-engineering Apple's private `CoreSimulator` RPC protocols. 
The best starting points for a Rust/C++ replacement are:
1.  **Facebook's `idb` (iOS Device Bridge):** FB reverse-engineered many `CoreSimulator` private APIs to build their headless simulator control tools. We would need to port their Objective-C `FBSimulatorControl` surface extraction and HID injection logic to Rust.
2.  **Appium / WebDriverAgent:** For input injection reference.
# D26 — Pen, touch and hardware-backed device providers

**Purpose:** leave room for interactions that ordinary synthetic mouse/keyboard events cannot faithfully express. **Sources:** USB HID usage definitions [S37](29-research-register.md#s37), Apple's HID/virtual-device capabilities [S38](29-research-register.md#s38). A usage-table entry or entitlement name is not proof that a shipped provider can emulate the device in all applications.

## 1. Capability taxonomy

Extend the contract with named channels: mouse, keyboard, scroll, pen, touch contacts and optional device-specific sensors. Pen capabilities include position, pressure, tilt, rotation, proximity and buttons only when actually supported. Touch includes contact IDs/phases/count/range. Unsupported axes remain absent; do not fill zeros and claim full capability.

A pointer path with `pressure` cannot fall back silently to a mouse path that ignores pressure. The host may request an explicit approximation, which changes the operation profile/result description. Qualification distinguishes public software posting, supported virtual-device provider and physical hardware appliance.

## 2. Provider selection

Keep all hardware-specific native code behind `DeviceProvider` with typed profile, preflight, timeline submit, receipt and cleanup. Core public mouse/keyboard provider remains available. A rich provider cannot bypass the same grant/seat/cursor/visibility model.

Virtual HID solutions may require platform approval/provisioning and supported DriverKit/system-extension packaging. Verify actual SDK API availability and required entitlements. Do not use private undocumented injection or disabling SIP/TCC as a deployment plan. If the platform does not grant the capability, report unavailable and use an explicit physical device experiment or supported application route.

## 3. Physical appliance research track

An external authenticated controller presenting a real supported HID device is a possible route for certain app/hardware requirements. It needs a physical stop, connection authentication, firmware/version identity, bounded command queue, input-state watchdog and observable cursor/capture alignment. Hardware does not make arbitrary actions safe or automatically authorized.

The appliance receives bounded timeline commands from the trusted native host, not arbitrary guest USB writes. Disconnect/watchdog releases its own contacts/keys where the protocol permits. A stuck physical device is a distinct fault class with a documented manual stop. Do not claim software can always clean up hardware after total power loss.

## 4. Calibration

Calibrate coordinate ranges, display mapping, pressure curves, sample rates, latency and contact semantics per device/OS/application. Store profile version and confidence envelope. Pen input and mouse pointer may coexist; make the active instrument clear to the human rather than drawing a false mouse cursor at a pen contact that is elsewhere.

For touch, the visible overlay may show contact points and trajectories, but actual contacts must match the display/calibration. Multi-contact gestures run on the native timeline, not one model call per finger. Validate contact balance and tool-specific constraints before admission.

## 5. Application outcome

A drawing app can accept mouse input but ignore pressure, or require an actual pen event path. Qualification verifies both low-level receipt where observable and meaningful application effects, such as varying stroke width according to the programmed pressure in a controlled brush profile. One successful app does not qualify all PencilKit or WebKit consumers.

A target that rejects a provider remains an explicit failure. Do not use import/scripting APIs behind the scenes to make a hardware test appear successful. Hybrid app APIs can be separate capabilities when the user chooses them.

## 6. Implementation and tests

Reserve versioned IDL channel descriptors now but expose only actually implemented providers in discovery. Future implementation belongs in dedicated native packages/adapters, not arbitrary guest-accessible system libraries. Firmware/artifact signing and update authority are separate release concerns.

**DEV-01:** unsupported axes are rejected before effects. **DEV-02:** virtual provider cannot launch without proper platform support. **DEV-03:** pressure/contact geometry is measured against application effect. **DEV-04:** disconnect and stop release/terminate owned state as qualified. **DEV-05:** no silent mouse approximation. **DEV-06:** calibration invalidates on display/seat changes. **DEV-07:** hardware commands are authenticated and bounded. **DEV-08:** cursor/contact presentation matches real device output. **DEV-09:** grants remain scoped per seat/app. **DEV-10:** device/app failures are reported, not concealed by hybrid completion. These are extension deliverables after the core AID environment is useful and qualified.

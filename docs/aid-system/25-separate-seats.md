# D25 — Independent agent desktops and remote seat routing

**Purpose:** eventually let a human continue working while an agent controls an independently owned desktop that the human can watch. **Sources:** Apple's macOS Virtualization guidance [S42](29-research-register.md#s42). This is an extension, not a prerequisite or workaround that conceals failure on the user's actual Mac.

## 1. Seat definition

A seat is a real input/focus domain with its own login/session generation, display/capture providers, foreground ownership and native driver. A macOS Space, another display or another app window does not by itself create independent keyboard/focus ownership. Keep the one-writer rule for each actual seat.

Supported provider categories are `local-login`, `remote-machine`, and `qualified-vm`. Each exposes device/capture capabilities, runtime generation, control lease, authenticated principal binding and visibility channel. No provider may claim it represents the user's current desktop when it is a different environment.

## 2. Local-first core and routing

The initial implementation uses the current logged-in Mac seat. The protocol-neutral IDs include seat/runtime identity now so a future provider does not require changing all contracts. Actual remote control requires separate enrollment, peer authentication, encryption, revocation and local emergency stop on the controlled machine.

An execution stays bound to one seat/control unless it explicitly acquires another allowed seat. Live AX/window/surface handles cannot migrate between machines. Pure source/data may be transferred under export policy; application state, credentials and open documents are not assumed shared.

## 3. VM provider

Apple's Virtualization framework documents macOS guests on Apple silicon, with supported restore images and explicit virtual hardware configuration. Qualification must verify OS/host compatibility, guest graphics/input behavior, app availability and distribution/licensing constraints before offering a provider. Do not promise Intel hosts or every macOS version can run the same guest setup.

The AID driver runs inside the guest and receives its own genuine permissions. Host TCC grants do not automatically authorize guest apps, nor do guest grants grant host capture. Guest snapshot restore revokes all previous control epochs and live handles; it is not a way to resume arbitrary uncertain GUI effects against old IDs.

## 4. Human visibility

Stream the **actual remote/guest desktop** to the person, labelled by seat name. Show current control scope, connection quality, capture delay and Stop. The model can receive selected observations separately; the user's live preview is not evidence that a provider model saw every frame.

Input/cursor synchronization is performed on the controlled seat. Rendering a pointer locally over a delayed remote image is insufficient to claim causal physical feedback. Prefer the real Cozea cursor rendered in the captured remote desktop, with explicit measured capture/transport latency. A preview outage pauses new sensitive input under the configured visibility policy; do not keep running invisibly merely because the native controller remains connected.

## 5. Network and authority

Use authenticated encrypted channels with per-machine enrollment and expiring seat grants. A remote relay cannot forge owner/device context. Separate preview bandwidth from urgent stop/control and evidence artifacts. Heartbeats apply at both host-to-seat and seat-to-driver boundaries; dropped video does not necessarily equal dropped control, so policy specifies which failures require pause versus revoke.

Network retries use execution/operation IDs and journal status, never replay raw clicks blindly. A remote disconnect after a possible effect remains uncertain until the same surviving runtime can report or new evidence is acquired. Latency budgets include network RTT separately; local A/B overhead targets do not apply unchanged.

## 6. Files, accounts and hybrid behavior

A task requiring a particular account/document must state whether it exists on the selected seat. Copying data into a VM is an explicit export/import capability, not an invisible fallback. Shared folders, clipboard sync and account credentials are denied by default and separately granted. Do not let a guest worker mount arbitrary host paths.

Remote desktop operation still qualifies as visible GUI interaction if the person sees the actual effects on the labelled seat. A direct file API on that seat remains hybrid execution and must not masquerade as drag/drop.

## 7. Scheduling and future scale

A multi-seat scheduler can allocate different seats to different executions, but must not move an active program to another seat to evade contention without reacquisition. Preparing an independent seat may take time; show that cost separately from native input latency. Per-seat quotas and licensing/capture consent are explicit.

Reusable skills carry environment profiles so a procedure validated locally is not presumed valid in a resized VM or remote display. The same portable device/evidence contract remains useful; capability manifests state differences.

## 8. Tests and implementation

Define `SeatProvider`/`SeatDirectory`/`RemoteSeatTransport` interfaces now; implement only local-login in core. Future remote provider first targets a second enrolled physical Mac before VM-specific complexity. Then qualify a VM provider using supported platform configuration.

**SEAT-01:** concurrent seats do not share input/focus. **SEAT-02:** Spaces/displays are not mislabeled independent seats. **SEAT-03:** cross-seat handles fail. **SEAT-04:** preview is the actual controlled desktop and reports delay. **SEAT-05:** remote loss triggers defined stop/uncertainty. **SEAT-06:** host/guest grants and shared data remain separate. **SEAT-07:** restored VM invalidates epochs. **SEAT-08:** machine enrollment/revocation is authenticated. **SEAT-09:** emergency stop works locally on controlled seat. **SEAT-10:** supported OS/hardware/licensing constraints are recorded before release. Gate G11 applies only when enabling these providers.

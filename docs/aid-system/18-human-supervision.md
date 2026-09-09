# D18 — Human supervision, truthful feedback and immediate takeover

**Purpose:** let a person understand and interrupt real computer interaction without slowing every action artificially. **Baseline seams:** `CozeaChatSurface`, `WorkbenchAssistantChatTile`, existing workbench overlay/portal rules, Computer Use settings and native cursor. **Sources:** Electron security/ports [S25](29-research-register.md#s25), [S47](29-research-register.md#s47), optional MCP Apps [S52](29-research-register.md#s52).

## 1. Product surface

Add a compact control panel to the assistant's existing chat/workbench surface, not a new browser host. It shows logical task, selected app/window, mode (`visible-ui`, `physical-ui`, `hybrid`), presentation pacing, current operation/phase, capture scope, and Stop/Pause/Take over. The actual desktop remains the primary visual feedback.

The panel never says Completed solely because a tool returned `submitted`. Display the execution result and outcome-verification status separately. For ambiguous delivery, show “input may have been sent; result not verified,” with an observation action and last completed operation. This is not an alarm for every normal unverified primitive; aggregate routine receipts while surfacing genuine uncertainty.

## 2. UI state model

Use a typed `AidSupervisionState` projection from host authority/journal: idle, requesting-control, active, waiting-model, waiting-user, paused, stopping, quiescent, completed, failed and interrupted-uncertain. Renderer does not infer control from stream text or cursor visibility.

`Pause` requests a safe boundary, releases owned held input when necessary and parks further effects. `Stop` synchronously revokes native admission through the urgent host channel, then waits for cleanup confirmation. `Take over` performs stop/release and leaves the user's pointer/focus untouched. Resuming requires fresh control/targets; a paused old grant does not silently regain foreground after human action.

A hung renderer cannot be the only stop mechanism. The native driver provides a status-item stop and a qualified global shortcut/input monitor. The UI indicates whether those controls are available. Never promise emergency stop from a toolbar whose process can be blocked by the code it supervises.

## 3. Visual causality and pacing

Show cursor, real text entry and resulting application state. High-frequency progress can be summarized as “Drawing stroke8/20” while all strokes appear in the real canvas. Do not animate artificial highlights to imply UI changes that did not happen. A semantic AX press can be labelled accurately without pretending a low-level mouse event was used.

Fast-visible mode prioritizes throughput with visible contact. Presentation mode offers slower motion for teaching/demonstrations. Neither mode is a permission boundary. Sensitive operations require prior approval when policy dictates; slowing the mouse is not equivalent to consent.

The control panel should remain accessible by keyboard and screen reader. Respect system Reduce Motion and contrast preferences in decorative animation while preserving clear target/stop status. Avoid flashing or oversized cursor halos that obscure controls.

## 4. Approvals

A human approval panel is generated from trusted action/grant metadata plus relevant evidence: target app/window, requested capability, action description, content summary where permitted, scope and expiry. Distinguish approving one effect, a bounded task scope and an optional hybrid capability. No default broad permission hidden in a one-click prompt.

Approval response carries checkpoint ID and trusted UI response identity; the host revalidates dependencies immediately before effect. If a target changed while the person read the prompt, show updated evidence and ask again instead of applying the old approval to a different button. Denial never executes or automatically substitutes a terminal route.

Keep model-decision checkpoints visually distinct from human permission requests. The agent thinking about which result to choose is not asking the person for consent unless a real policy question exists.

## 5. Input monitoring and capture feedback

Monitor relevant physical user interference/focus/lock signals through qualified native mechanisms. Own-event tags are operational hints, not secure identity. Unexpected target movement or user control during a gesture stops new input; a passive pointer elsewhere need not cancel read-only evidence gathering. The driver must not block human input to preserve a animation or repeatedly steal focus back.

Capture indicator UI shows which active scopes are being sampled and whether pixels are merely local, retained for debugging or exported. macOS's system indicator reflects OS capture behavior, not model awareness. Explain that warm capture is not continuous model video without suggesting local capture has no privacy cost.

## 6. Event transport and app integration

Expose a narrow preload/IPC API from Electron main: subscribe supervision state, pause/stop/respond, request diagnostics and explicitly view evidence. Verify sender/frame and owning project/thread. Use existing portal/layer conventions; never instantiate a parallel `WebContentsView` or bypass the T3 browser host rule.

Progress is bounded and coalesced to avoid rerendering per native sample. Initial UI update maximum is 10 Hz for continuous progress, immediate terminal/approval/stop updates, with stable object keys. Keep state in a host-backed store so hiding chat or switching its Artifacts tab does not kill execution ownership. Closing a tile is not automatically deleting a provider thread; apply existing app lifecycle rules.

MCP Apps may eventually mirror supervisory UI in another host. They are optional presentation adapters. A remote or embedded UI stop control must route to the same native authority and cannot be the only emergency path.

## 7. Acceptance

**UI-01:** actual target, mode and capture scope remain accurate while switching apps. **UI-02:** Stop works while JS is busy and renderer is deliberately stalled through native path. **UI-03:** stopping is not mislabeled quiescent before cleanup. **UI-04:** hidden/unmounted chat presentation does not orphan control. **UI-05:** duplicate approval click yields one response/effect. **UI-06:** changed target requires new approval. **UI-07:** screen-reader/keyboard controls and reduced motion work. **UI-08:** high-rate input does not create high-rate React renders. **UI-09:** takeover never warps/refocuses against user. **UI-10:** preview/evidence export is scoped to the owning assistant/project and no other renderer can invoke the control API. User-visible assertions are backed by native/journal events, not optimistic component state.

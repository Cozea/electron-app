# Agent chat motion stability

## Objective

The agent chat keeps its existing visual design, interaction semantics, timeline structure, composer behavior, tool presentation, fold behavior, Changed Files presentation, Plan flow, and Chat/Artifacts behavior. This work changes how geometry and transient state transitions are coordinated so the existing UI feels physically stable.

The core invariant is:

> A semantic state change should produce one intentional movement or no movement, never a movement followed by corrective movement.

## Scroll ownership

`MessagesTimeline` is the only owner of conversation scrolling. Workbench controllers may provide refs and state, but must not write `scrollTop` or otherwise force the timeline to an absolute position.

The existing near-bottom threshold remains 64px. When the reader is within that threshold and the floating composer changes its reserved inset, the timeline preserves the reader's current distance from the bottom while the inset transition runs. Wheel, touch, pointer, or keyboard interaction immediately cancels that temporary follow behavior. When the reader is outside the near-bottom threshold, composer changes do not move the reading position.

LegendList remains responsible for virtualization, item measurement, data/layout end maintenance, and visible-content preservation. The chat-owned inset-follow behavior is intentionally narrow: it exists only to preserve bottom distance while the overlaid composer changes the amount of reserved tail space.

## Composer geometry

The floating composer remains the same UI and retains its compact/stacked hysteresis. Its intrinsic target height is measured independently from the animated `max-height`, so the timeline receives one semantic inset target instead of a stream of measurements from the visual transition.

The composer shell limits its transition to `max-height`, transform, and opacity. The hidden shell remains measurable, which lets the timeline know its target geometry before hover/focus makes it visible.

On send, the durable draft is retained until runtime acknowledgement exactly as before. Once the optimistic turn is committed, only the presented composer value/images/annotations are hidden so the composer collapse and optimistic user bubble read as one visual transaction. A failed send therefore reveals the exact retryable durable draft again without reconstructing it.

## Active turn lifecycle

Working, Thinking, and Waiting retain their existing visual components and wording. They share one active-tail row identity and one LegendList item type so provider phase changes update a stable measured slot instead of removing one row and inserting another. These machine-driven state swaps use only a short opacity entrance and respect reduced motion.

Tool summaries, completed folds, provider plans/tasks, and other existing timeline structures are otherwise unchanged.

## Persistent presentation state

Automatic Changed Files expansion remains unchanged: a small latest diff can open automatically. Once that positive initial presentation decision is made, it is persisted in the existing per-turn expansion map. A newer turn becoming latest can therefore no longer collapse an older Changed Files card, including after virtualization recycles and remounts it.

## Late content and estimates

Timeline attachment estimates match the real fixed 128x96 attachment cards, the actual gap/margin geometry, the user-bubble width ratios, and the assistant content width. This reduces post-paint LegendList corrections.

Authorized Markdown images and video retain their existing final appearance. On first intrinsic load they reveal height and opacity over the existing 200ms motion budget instead of changing from a one-line loading placeholder to a large media box in one frame. A bounded media-key registry prevents this reveal from replaying when an old virtualized message remounts.

## Transient presence motion

Presence polish is intentionally small and uses existing CSS animation primitives rather than adding Motion/Framer Motion as a dependency:

- model picker: real enter/exit lifetime with opacity/position/scale transition;
- composer autocomplete: short fade/vertical entrance;
- settled response actions: short fade/vertical entrance;
- blocking question changes: short keyed fade/horizontal entrance;
- asynchronous question panel: short fade/vertical entrance;
- first thread-only header action: width/opacity interpolation into its existing 28px slot.

These transitions do not redesign the resting state and all respect `prefers-reduced-motion`.

## Verification contract

Focused tests cover:

- the 64px near-bottom threshold and bottom-distance math;
- stable Working/Thinking/Waiting row identity;
- composer intrinsic measurement and single timeline scroll ownership;
- durable-draft versus presented-draft send semantics;
- model-picker exit lifetime;
- persistent Changed Files automatic expansion;
- first-send header action geometry;
- attachment gallery height estimation at wide and narrow widths.

Before merge, run the focused chat suite plus desktop/test TypeScript checks, lint, format checks, and a production desktop build after preparing the pinned T3 runtime. Manual packaged/Desktop Dockview QA should still exercise hover composer behavior, long streaming turns, questions/approvals, media loading, tile resizing, and Chat/Artifacts switching because static CI cannot judge perceived motion continuity.

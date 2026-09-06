# Adaptive Desktop Geometry Plan

## Objective

Make Cozea behave like a resizable desktop workbench rather than a responsive website. Preserve the existing visual design and user-created Dockview topology while making the shell and each pane degrade predictably under space pressure.

The implementation distinguishes three geometry domains:

1. **Window geometry** — the Electron `BrowserWindow` and application shell. This owns global title-bar pressure, the persistent sidebar, full-window settings surfaces, and the application's supported minimum window envelope.
2. **Pane geometry** — the actual width and height assigned to an individual Dockview group. This owns local padding, metadata visibility, toolbars, action exposure, and compact presentation inside Agent, Browser, Changes, Selection, Memory, Terminal, and other workbench surfaces.
3. **Preview geometry** — the simulated guest viewport inside Browser/Dev Server previews. This remains independent from both window and pane geometry and continues to own responsive/freeform device emulation.

## Invariants

- Never automatically rewrite a user's Dockview topology because the main window or a pane becomes smaller.
- Preserve pane identity, tab order, split ratios, floating groups, and pop-out behavior.
- Stable desktop typography: window or pane resizing must not continuously scale type.
- Visual adaptation should prefer CSS/container queries. Use `ResizeObserver` only when behavior needs numeric geometry (xterm fit, canvas calculations, browser viewport sizing, virtualization, etc.).
- Desktop control density is stable. Narrow Electron windows do not become touch/mobile surfaces; pointer-coarse affordances remain the input-modality mechanism.
- Header/tool actions should preserve essential actions and compress secondary presentation before clipping or changing header height.
- Scroll ownership stays local to the surface that owns the content.

## Phase 1 — Desktop density and compact-window semantics

- Remove viewport-width-driven size inflation from shared desktop Button, Input, Toggle, Switch, and the mirrored assistant primitives.
- Keep the existing compact desktop control sizes as the default across window widths.
- Rename the internal `useIsMobile` concept to compact-window semantics while retaining a compatibility alias where useful for existing shadcn-style sidebar APIs.
- Document that the `<768px` sidebar sheet is a compact-window topology, not a mobile product mode.

Acceptance:

- Resizing the Electron window below Tailwind `sm` does not increase ordinary control heights.
- Coarse-pointer hit-area support remains intact.
- Sidebar behavior remains functionally unchanged.

## Phase 2 — Pane containment contract

- Make each Dockview `.dv-groupview` a named inline-size CSS container (`cozea-workbench-pane`).
- Keep the current per-tile minimum width/height registry and restored-layout constraint reapplication.
- Do not invent a universal `compact` breakpoint; each surface owns thresholds appropriate to its job.

Acceptance:

- Header chrome and pane content can query the same actual Dockview group width.
- Floating groups retain the same containment behavior.
- Existing resizing, drag/drop, maximize, tab overflow, and pop-out behavior is unchanged.

## Phase 3 — Agent/assistant pane conversion

- Replace viewport `sm:`/`md:` presentation decisions inside pane-hosted chat UI with `cozea-workbench-pane` container variants.
- Cover timeline horizontal padding, composer/pending panels, approval/follow-up states, image-viewer offsets, and other visible pane-hosted spacing.
- Keep numerical `ResizeObserver` use that supports virtualization, scroll anchoring, composer measurement, and other behavioral geometry.

Acceptance:

- A 320–400px Agent pane inside a very wide app uses the compact pane presentation.
- A wide Agent pane inside a relatively narrow app can use the spacious pane presentation when the pane itself has room.
- Message/composer scroll ownership and near-bottom behavior do not regress.

## Phase 4 — Selection and browser chrome

- Convert Selection's remaining viewport-based visual breakpoints to pane-local decisions while preserving its existing width/height-driven launcher algorithm.
- Keep Browser preview guest sizing independent.
- Apply pane-local pressure handling to Browser navigation chrome so the URL field remains useful before non-essential navigation controls consume it.

Acceptance:

- Selection uses its own Dockview allocation, not the main BrowserWindow width, for visual spacing/typography decisions.
- Browser preview device emulation remains unchanged.
- Browser header controls do not force horizontal overflow at the pane minimum.

## Phase 5 — Shell/title-bar pressure

- Keep `UnifiedHeader` visually centered but give left, center, and right regions explicit collision behavior.
- Preserve native macOS/Windows window-control clearance.
- Allow project identity/secondary metadata to truncate or compress before controls overlap.
- Do not wrap the title bar into multiple rows.

Acceptance:

- Collaboration, Changes/Share, editor controls, and window chrome can coexist at the supported narrow-window envelope without overlap.
- Title-bar height remains stable.

## Phase 6 — Geometry regression coverage

Add tests that protect behavior rather than Tailwind implementation strings.

Minimum matrix:

- 320px Agent pane inside an 1800px window.
- Wide Agent pane with the main window below a traditional web breakpoint.
- Three-way horizontal split near per-pane minima.
- Vertically shallow panes near minimum heights.
- Main sidebar at minimum and maximum persisted widths.
- Changes at 340px compact and 700px expanded widths.
- Browser device toolbar at its existing local thresholds.
- Floating and pop-out groups.
- macOS traffic-light and Windows caption-control title-bar pressure.
- Rapid sash dragging without remount/layout-state churn.

Assertions should focus on invariants such as no unintended horizontal overflow, no topology mutation, stable header height, reachable essential actions, and pane-local adaptation.

## Explicit non-goals

- Mobile/tablet product layouts.
- Fluid typography with `clamp()`.
- Automatic compact/comfortable density switching based on monitor size.
- Automatic Dockview stacking/tabbing/rearrangement.
- Replacing valid geometry-driven `ResizeObserver` logic with CSS merely for consistency.
- Reworking Browser guest responsive emulation.

## Delivery order

1. Desktop primitive density + compact-window naming.
2. Dockview pane containment.
3. Agent pane conversion.
4. Selection/browser chrome conversion.
5. Global title-bar pressure.
6. Geometry regression tests and documentation updates.

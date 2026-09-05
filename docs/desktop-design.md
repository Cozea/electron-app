---
name: Cozea Desktop
description: A calm, dense, and trustworthy capability switchboard for local software work.
colors:
  canvas: "rgb(8, 8, 8)"
  content-surface: "rgb(22, 22, 22)"
  raised-surface: "rgb(36, 36, 36)"
  container: "oklch(0.30 0 0)"
  foreground: "oklch(0.985 0 0)"
  muted-foreground: "oklch(0.708 0 0)"
  primary: "oklch(0.922 0 0)"
  primary-foreground: "oklch(0.205 0 0)"
  border: "oklch(1 0 0 / 10%)"
  input: "oklch(1 0 0 / 15%)"
  success: "oklch(0.723 0.167 149.214)"
  attention: "oklch(0.769 0.188 70.08)"
  destructive: "oklch(0.704 0.191 22.216)"
typography:
  headline:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "normal"
  caption:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "normal"
  micro-label:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "9px"
    fontWeight: 500
    lineHeight: "12px"
    letterSpacing: "0.025em"
  identity-mark:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "8px"
    fontWeight: 600
    lineHeight: "8px"
    letterSpacing: "normal"
  mono:
    fontFamily: "JetBrains Mono Variable, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "24px"
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  2xl: "18px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "4px 11px"
    height: "32px"
  button-outline:
    backgroundColor: "{colors.raised-surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "4px 11px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "4px 11px"
    height: "32px"
  input:
    backgroundColor: "{colors.raised-surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "4px 11px"
    height: "32px"
  container:
    backgroundColor: "{colors.container}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "24px"
  nav-item-active:
    backgroundColor: "{colors.raised-surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
    height: "28px"
---

# Design System: Cozea Desktop

## Overview

**Creative North Star: "The Capability Switchboard."**

Cozea should feel like a well-built technical instrument: calm enough for sustained concentration, dense enough to keep real work in view, and trustworthy enough for consequential actions. The visual system supports that feeling with graphite semantic surfaces, restrained tonal layering, compact controls, and precise state communication.

The switchboard metaphor is operational rather than decorative. Persistent navigation, workbench panes, inspectors, terminals, and agent surfaces should read as parts of one coordinated desktop environment. Provider identity may appear as a small accent or mark, but the shared Cozea hierarchy remains dominant. Agent Skills demonstrates a focused settings flow: the library list, selected-skill detail, and editor occupy the same content region in sequence, while secondary operations stay in an overflow menu and instructions remain collapsed until requested.

The system rejects marketplace-card-grid and oversized marketing-dashboard language inside the authenticated product. Refined geometry, quiet transitions, and explicit labels carry the character; inflated cards, decorative gradients, and promotional scale do not.

**Key Characteristics:**

- Graphite semantic surfaces with restrained tonal separation
- Compact 13px desktop copy and clear, limited heading steps
- Operational controls with precise hover, focus, disabled, and destructive states
- Small provider accents within a coherent shared shell
- Emerald for healthy or active, amber for attention or restart, and red for destructive or failed states

## Colors

The canonical dark reference is a near-black graphite stack; every supported theme remaps the same semantic roles rather than changing the product hierarchy.

### Primary

- **Primary Control** (`colors.primary`): The highest-emphasis control fill and active affordance. Pair it only with `colors.primary-foreground`.

### Secondary

- **Operational Emerald** (`colors.success`): Healthy, connected, completed, or actively available states.
- **Attention Amber** (`colors.attention`): Restart requirements, compatibility attention, or a state that needs review but is not yet a failure.

### Tertiary

- **Destructive Red** (`colors.destructive`): Removal, deletion, failed operations, and validation errors.

### Neutral

- **Graphite Canvas** (`colors.canvas`): The deepest application and workbench backdrop.
- **Graphite Content** (`colors.content-surface`): The default workspace and tile plane.
- **Raised Graphite** (`colors.raised-surface`): Inputs, hover fills, active rows, and subtly elevated controls.
- **Graphite Container** (`colors.container`): Popovers, provider blocks, and clearly bounded containers.
- **Clear Foreground** (`colors.foreground`): Primary readable copy and icons.
- **Muted Foreground** (`colors.muted-foreground`): Metadata, descriptions, inactive states, and explanatory copy.
- **Quiet Edge** (`colors.border`): Pane dividers and container outlines; it should remain visible without becoming a grid.
- **Input Edge** (`colors.input`): The slightly stronger control boundary used by fields and outline controls.

### Named Rules

**The Semantic Surface Rule.** Feature UI uses semantic surface, foreground, border, and state roles so Light, Dark, Navy, Wine, Clay, Forest, and System remain coherent.

**The Small Accent Rule.** Provider or brand color stays inside compact identity marks, badges, or local highlights; it never washes an entire work pane.

**The State Color Rule.** Emerald communicates healthy or active, amber communicates attention or restart, and red communicates destructive, failed, or invalid states.

## Typography

**Display Font:** Inter (with system UI fallbacks)

**Body Font:** Inter (with system UI fallbacks)

**Label/Mono Font:** JetBrains Mono Variable (with platform monospace fallbacks)

**Character:** Inter keeps the shell neutral, crisp, and highly legible at desktop density. JetBrains Mono identifies code, instructions, slugs, paths, and technical metadata without turning ordinary interface copy into developer theater.

### Hierarchy

- **Headline** (600, 1.25rem, 1.75rem): Dialog titles, inspector titles, and substantial section identities.
- **Title** (600, 1.125rem, 1.75rem): Page titles and compact surface titles.
- **Body** (400, 13px, 20px): Default application copy, descriptions, navigation, and table content.
- **Label** (500, 13px, 20px): Buttons, form labels, compact section headings, and status labels.
- **Caption** (500, 11px, 16px): Compact operational metadata, restart notes, and secondary control context.
- **Micro Label** (500, 9px, 12px): Short uppercase source or state tags where a 13px label would overpower the row.
- **Identity Mark** (600, 8px, 8px): One- or two-letter provider marks inside fixed compact symbols; never use it for prose.
- **Mono** (400, 13px, 24px): Instruction bodies, code, slugs, paths, and technical readouts.

### Named Rules

**The Desktop Copy Rule.** Default interface copy is 13px with a 20px line-height; larger sizes are reserved for real hierarchy, not card decoration.

**The Mono Evidence Rule.** Monospace identifies executable or inspectable material; prose, navigation, and ordinary labels remain in Inter.

## Layout

Cozea uses a persistent desktop shell around a flexible workbench. The primary sidebar is 16rem wide on desktop, collapses or moves into an 18rem sheet on small screens, and yields the remaining width to resizable or split work surfaces. Workbench content should preserve clear pane ownership through dividers, headers, and local scroll regions.

The layout rhythm is based on 4px increments. Controls typically use 8–12px internal spacing, compact groups use 8–16px gaps, and major pane headers or inspector sections use 20–24px padding. Density should feel information-rich, not cramped: keep related controls close and let pane boundaries, not empty space, establish structure.

Responsive changes preserve the job rather than merely stacking everything. Sidebars become sheets, secondary inspector columns collapse when width is insufficient, and local toolbars wrap before labels are removed. Agent Skills keeps its filter sidebar but moves the library, detail, and editor through one focused settings column instead of preserving simultaneous panes merely because width is available.

## Elevation & Depth

Depth is tonal first and shadow second. The canvas, content, raised, and container roles establish most hierarchy; thin low-contrast borders make ownership explicit. Small controls and containers use barely perceptible low shadows or one-pixel edge highlights, while overlays add a muted backdrop and modest scale/opacity transition. The native sidebar may use vibrancy, blur, and a recessed inner shadow, but the workbench itself remains visually stable.

### Shadow Vocabulary

- **Control Low** (`0 1px 2px rgb(0 0 0 / 0.05)`): A quiet resting edge on fields, buttons, rows, and compact containers.
- **Dark Edge Highlight** (`0 -1px 0 rgb(255 255 255 / 0.06)`): A subtle inner top edge on dark raised controls.
- **Sidebar Recess** (`inset -32px 0 36px -22px rgb(0 0 0 / 0.18)`): Separates a dark translucent sidebar from the content plane.

### Named Rules

**The Tonal-First Rule.** Separate ordinary panes with semantic surface steps and quiet borders before adding shadow.

**The Overlay Exception Rule.** Stronger elevation belongs to transient menus, tooltips, dialogs, and native-vibrancy boundaries—not to every card at rest.

## Shapes

Cozea uses compact, gently rounded geometry rather than sharp enterprise boxes or oversized soft cards. Navigation rows sit at 6–8px, standard controls at 10px, cards and bounded panes at 14px, and dialogs at 18px. Checkboxes may use a tighter 4px corner, while pills and switches use a full radius only when their silhouette communicates the control type.

Borders are usually one pixel and semantically quiet. Avoid stacking several rounded containers when a divider, section heading, or tonal change can express the same hierarchy. Clipping is intentional for grouped settings rows, popovers, code panels, and other surfaces with owned scroll regions.

## Components

Components are refined, compact, and operational. They communicate state through semantic color, restrained motion, and exact labels rather than ornamental treatments.

### Buttons

- **Shape:** Gently rounded standard controls (`rounded.lg`, 10px) with 32px default desktop height; compact toolbar controls may use 28px.
- **Primary:** `colors.primary` on `colors.primary-foreground`, 11px horizontal padding, medium label weight, and a subtle low shadow.
- **Hover / Focus:** Hover changes the fill by one tonal step; focus uses the semantic ring plus a background offset. Pressed controls drop the resting shadow, and disabled controls preserve layout at reduced opacity.
- **Outline / Ghost / Destructive:** Outline buttons use the input edge and raised surface, ghost buttons acquire an accent fill only on interaction, and destructive actions reserve red for the consequential path.

### Chips

- **Style:** Compact labels use 4–6px corners, medium 13px type, and short horizontal padding. Status chips use a low-opacity semantic surface with a stronger semantic foreground.
- **State:** Use words such as “External,” “Local · free,” or “Not compatible” when the distinction matters; do not rely on color alone.

### Cards / Containers

- **Corner Style:** Bounded work containers use the 14px card radius; dialogs use the 18px dialog radius.
- **Background:** Choose among content, raised, and container roles according to hierarchy, not page novelty.
- **Shadow Strategy:** Use Control Low or no shadow at rest; tonal layering and one-pixel borders carry ordinary separation.
- **Border:** Use `colors.border` with reduced emphasis for internal dividers.
- **Internal Padding:** Use 12–16px for dense rows and 20–24px for pane headers or inspector sections.

### Inputs / Fields

- **Style:** Inputs are 32px high on desktop, 10px rounded, and use the input edge over a raised or popover surface.
- **Focus:** Shift the border to the semantic ring and add a three-pixel low-opacity ring; remove the resting shadow while focused.
- **Error / Disabled:** Invalid fields shift border and ring to destructive red. Disabled fields keep their footprint, lose pointer interaction, and reduce opacity.

### Navigation

Primary navigation uses 28px rows, 8px horizontal padding, small icons, regular 13px labels, and a restrained rounded active fill. Hover and focus use the same semantic family as selection without changing row height. Persistent desktop navigation may use native translucency, but labels and active state must remain legible in every theme.

### Focused Library and Detail

For inventory-and-inspection work, begin with one grouped settings list and let selection replace it with a focused detail view. Each row carries one strong label, one concise description, and one quiet source/provider summary; the detail view owns provider switches, metadata, and progressive disclosure of full instructions. A visible back control preserves orientation, while secondary library actions belong in an overflow menu.

### Dialogs and Overlays

Dialogs use an 18px radius, 24px padding, a quiet border, restrained low shadow, and a black translucent backdrop with light blur. Menus and tooltips remain compact, scale by only a few percent as they appear, and never compete with the underlying work.

Component state motion typically completes in 120–200ms. Structural sidebar changes use the established 300ms `cubic-bezier(0.22, 1, 0.36, 1)` curve, and reduced-motion preferences remove decorative animation.

## Do's and Don'ts

### Do:

- **Do** build with semantic surface, foreground, border, and state roles so every supported theme remains coherent.
- **Do** keep desktop copy compact at 13px/20px and reserve larger type for real headings.
- **Do** use tonal layering, thin borders, and low shadows to separate panes before reaching for stronger elevation.
- **Do** keep provider accents contained to small marks, badges, or identity cues.
- **Do** show consequential states with explicit labels and the established emerald, amber, or red semantics.

### Don't:

- **Don't** turn operational pages into marketplace card grids or oversized marketing dashboards.
- **Don't** show the Agent Skills library, provider controls, full instructions, and sharing actions simultaneously; reveal the layer needed for the current decision.
- **Don't** use large decorative typography, inflated cards, or gratuitous whitespace inside the workbench.
- **Don't** hardcode one theme's literal colors in feature components when a semantic token exists.
- **Don't** use state color as decoration or let provider color dominate a pane.

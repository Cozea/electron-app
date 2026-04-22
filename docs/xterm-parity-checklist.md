# Xterm Parity Checklist

This checklist tracks Cozea's embedded terminal parity against the two most useful comparison targets:

- `VS Code` as the primary desktop-quality reference for an xterm-based terminal
- `t3code` as the closest app-level control case because it also uses xterm.js in a similar product shape

## Goal

Get Cozea's terminal behavior and rendering to the point where remaining gaps can be treated as deliberate product choices or normal xterm/browser limits, not integration mistakes.

## Shared Fixes Already Landed

- [x] Stop stripping `CSI 6 n` / `ESC[6n` from PTY output in [`electron/services/TerminalService.ts`](../electron/services/TerminalService.ts).
- [x] Stop booting xterm with guessed startup `cols` and `rows` in [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx).
- [x] Stop mutating color behavior in ways that diverge from the comparison targets:
  - remove xterm color rewriting via `minimumContrastRatio` in [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx)
  - stop stripping OSC `10/11/12` color-query sequences in [`electron/services/TerminalService.ts`](../electron/services/TerminalService.ts)

## VS Code Alignment

- [x] Add VS Code's macOS `AppleBraille` fallback in [`src/lib/xtermTheme.ts`](../src/lib/xtermTheme.ts).
  - VS Code reference: `/Users/admin/Downloads/vscode/src/vs/workbench/contrib/terminal/browser/terminalConfigurationService.ts`
  - Reason: this was the strongest likely cause of dotted / broken braille-style Claude Code art on macOS.

- [x] Match VS Code's font-family fallback behavior more closely in [`src/lib/xtermTheme.ts`](../src/lib/xtermTheme.ts).
  - VS Code always appends `, monospace`, and then `, AppleBraille` on macOS.

- [x] Enable and validate WebGL glyph/layout settings in [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx).
  - `customGlyphs`
  - `rescaleOverlappingGlyphs`
  - Unicode 11 width handling

- [x] Compare our WebGL renderer lifecycle to VS Code's and confirm we are not missing a renderer-specific initialization step.
  - Cozea loads `@xterm/addon-webgl` in [`src/lib/xtermTheme.ts`](../src/lib/xtermTheme.ts).
  - Cozea now performs a post-WebGL fit and PTY resize to settle renderer dimensions after GPU activation.

- [x] Recheck first-paint sizing after the startup-size fix and confirm the PTY and xterm agree before the first TUI frame lands.

- [x] Compare lower-priority xterm options and capability plumbing.
  - Cozea now exposes the same `windowOptions` pixel and char size queries and enables `scrollOnEraseInDisplay`.

## t3code Alignment

- [x] Match the base font-family stack more closely with `t3code`.
  - Cozea: [`src/lib/xtermTheme.ts`](../src/lib/xtermTheme.ts)
  - t3code reference: `/Users/admin/Downloads/t3code/apps/web/src/components/ThreadTerminalDrawer.tsx`
  - Cozea still intentionally appends `AppleBraille` on macOS for the VS Code-style fallback.

- [x] Match the practical xterm mount pattern.
  - Cozea terminal: [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx)
  - t3code terminal: `/Users/admin/Downloads/t3code/apps/web/src/components/ThreadTerminalDrawer.tsx`
  - Both now follow the same practical pattern: `open()` immediately, `fit()` immediately, then a short follow-up fit/resize pass.

- [x] Compare terminal host styling so we can separate emulator issues from CSS/layout issues.
  - The terminal host container is now effectively aligned: full-size mount, overflow hidden, rounded corners, and no exotic transforms on the xterm host itself.

- [x] Review WebGL usage directly.
  - Cozea includes `@xterm/addon-webgl`.
  - `t3code` does not appear to use xterm WebGL.
  - Cozea intentionally keeps WebGL because VS Code also uses it, so this is a reviewed divergence rather than an unchecked gap.

- [x] Confirm core sizing and typography similarities.
  - Same xterm major version family in `package.json`
  - Same `fontSize` of `12`
  - Same `lineHeight` of `1.2`

## Remaining Validation

- [ ] Reproduce the Claude Code onboarding screen side by side in Cozea, VS Code, and `t3code`.
- [ ] Capture comparison screenshots after any future terminal rendering changes so we can tell whether a change improved glyph shape, cell spacing, or both.

## Out Of Scope

- Native Ghostty-only advantages.
  - Ghostty is a native emulator with a different rendering stack and a higher ceiling than xterm.js.
  - This checklist is only about closing the gap to strong xterm-based references.

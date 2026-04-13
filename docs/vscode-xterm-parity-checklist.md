# VS Code Xterm Parity Checklist

This checklist tracks the remaining differences between Cozea's embedded terminal and VS Code's xterm integration.

## Goal

Get Cozea's terminal behavior and rendering as close as reasonably possible to VS Code's xterm-based terminal before we treat any remaining issues as browser-rendering limits.

## Already Fixed

- [x] Stop stripping `CSI 6 n` / `ESC[6n` from PTY output in [`electron/services/TerminalService.ts`](../electron/services/TerminalService.ts).
- [x] Stop booting xterm with guessed startup `cols` and `rows` in [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx).
- [x] Stop overriding xterm's `minimumContrastRatio` in [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx).

## Remaining Parity Gaps

- [x] Add VS Code's macOS `AppleBraille` fallback in [`src/lib/xtermTheme.ts`](../src/lib/xtermTheme.ts).
  - VS Code reference: `/Users/admin/Downloads/vscode/src/vs/workbench/contrib/terminal/browser/terminalConfigurationService.ts`
  - Reason: this is the most likely cause of the dotted / broken braille-style Claude Code art on macOS.

- [x] Match VS Code's font-family fallback behavior more closely in [`src/lib/xtermTheme.ts`](../src/lib/xtermTheme.ts).
  - VS Code always appends `, monospace`, and then `, AppleBraille` on macOS.
  - Cozea currently uses a simpler hardcoded stack.

- [x] Stop stripping OSC `10/11/12` color-query sequences in [`electron/services/TerminalService.ts`](../electron/services/TerminalService.ts).
  - Reason: VS Code does not mutate the terminal stream this way, and we should prefer protocol fidelity unless we have a concrete bug we are containing.

- [x] Enable and test WebGL `customGlyphs` behavior in [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx).
  - VS Code reference: `/Users/admin/Downloads/vscode/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts`
  - Reason: this helps line and block continuity in xterm's WebGL renderer.
  - Note: our xterm build exposes this through terminal options rather than the `WebglAddon` constructor.

- [x] Enable and test `rescaleOverlappingGlyphs` in [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx).
  - VS Code reference: `/Users/admin/Downloads/vscode/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts`
  - Reason: this improves ambiguous-width glyph rendering when fallback fonts are involved.

- [x] Add Unicode version support and test Unicode 11 in [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx).
  - VS Code reference: `/Users/admin/Downloads/vscode/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts`
  - Reason: modern Unicode width handling can affect wide characters, emoji, and some terminal art layouts.

- [x] Compare our WebGL renderer lifecycle to VS Code's and confirm we are not missing a renderer-specific initialization step.
  - Cozea loads `@xterm/addon-webgl` in [`src/lib/xtermTheme.ts`](../src/lib/xtermTheme.ts).
  - VS Code has richer WebGL management, including `customGlyphs` and renderer reconfiguration.
  - Cozea now performs a post-WebGL fit and PTY resize to settle renderer dimensions after GPU activation.

- [x] Recheck first-paint sizing after the startup-size fix and confirm the PTY and xterm agree before the first TUI frame lands.
  - This was partially addressed by removing guessed `cols` and `rows`, but it is still worth validating against VS Code behavior.

## Lower-Priority VS Code Differences

- [x] Compare secondary xterm options such as `allowTransparency`, `windowOptions`, and related terminal capability plumbing.
  - Cozea now exposes the same `windowOptions` pixel and char size queries and enables `scrollOnEraseInDisplay`.
- [x] Compare whether VS Code's configuration service is implicitly giving us other safer defaults that we are currently not setting.
  - Remaining differences are now broader editor/runtime concerns, not obvious terminal-fidelity gaps.

## Explicitly Out Of Scope For This List

- Native Ghostty-only advantages.
  - Ghostty is a native emulator with a different rendering stack and a higher ceiling than xterm.js.
  - This checklist is only about closing the gap to VS Code's xterm-based result.

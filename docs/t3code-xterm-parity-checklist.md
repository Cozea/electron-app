# t3code Xterm Parity Checklist

This checklist tracks the remaining differences between Cozea's embedded terminal and `t3code`'s xterm integration.

## Goal

Get Cozea to the same practical xterm quality bar as `t3code`, which is a much closer comparison target than Ghostty because both apps use xterm.js.

## Already Fixed

- [x] Stop stripping `CSI 6 n` / `ESC[6n` from PTY output in [`electron/services/TerminalService.ts`](../electron/services/TerminalService.ts).
- [x] Stop booting xterm with guessed startup `cols` and `rows` in [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx).
- [x] Remove xterm color rewriting via `minimumContrastRatio` in [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx).

## Current Similarities

- [x] Same xterm major version family in `package.json`.
- [x] Same `fontSize` of `12` in [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx) and `/Users/admin/Downloads/t3code/apps/web/src/components/ThreadTerminalDrawer.tsx`.
- [x] Same `lineHeight` of `1.2` in [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx) and `/Users/admin/Downloads/t3code/apps/web/src/components/ThreadTerminalDrawer.tsx`.
- [x] Both use `open()` followed by `fit()` semantics now.

## Remaining Parity Gaps

- [x] Match the font-family stack more closely with `t3code`.
  - Cozea: [`src/lib/xtermTheme.ts`](../src/lib/xtermTheme.ts)
  - t3code reference: `/Users/admin/Downloads/t3code/apps/web/src/components/ThreadTerminalDrawer.tsx`
  - Note: the base stack now matches `t3code` more closely; Cozea still intentionally appends `AppleBraille` on macOS for the VS Code-style braille fallback.

- [x] Stop mutating the PTY stream beyond what `t3code` does.
  - Cozea no longer strips OSC `10/11/12` queries in [`electron/services/TerminalService.ts`](../electron/services/TerminalService.ts).

- [x] Compare renderer initialization details and confirm Cozea is not introducing extra timing or resize churn around first paint.
  - Cozea terminal: [`src/features/projects/components/TerminalInstance.tsx`](../src/features/projects/components/TerminalInstance.tsx)
  - t3code terminal: `/Users/admin/Downloads/t3code/apps/web/src/components/ThreadTerminalDrawer.tsx`
  - Cozea now follows the same practical mount pattern: `open()` immediately, `fit()` immediately, then a short follow-up fit/resize pass.

- [x] Compare container CSS and terminal host styling so we can separate emulator issues from layout and scaling issues.
  - Padding, sizing, and CSS transforms can make a healthy xterm instance still look wrong.
  - The terminal host container is already effectively aligned: full-size mount, overflow hidden, rounded corners, and no exotic transforms on the xterm host itself.

- [x] Compare WebGL usage directly.
  - Cozea includes `@xterm/addon-webgl`.
  - `t3code` does not appear to use xterm WebGL at all.
  - Cozea intentionally keeps WebGL because VS Code also uses it, so this is now a reviewed divergence rather than an unchecked gap.

## Nice-To-Have Validation

- [ ] Reproduce the Claude Code onboarding screen in both apps side by side after each fix.
- [ ] Capture a screenshot after each change so we can see whether the fix improved glyph shape, cell spacing, or both.

## Why This List Exists Separately

`t3code` is a strong control case because it also uses xterm.js. If Cozea still renders worse after matching `t3code` on the remaining items above, that points much more strongly to our local integration and styling rather than to xterm.js itself.

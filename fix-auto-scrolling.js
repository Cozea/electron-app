const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/TerminalInstance.tsx', 'utf8');

file = file.replace(
  /const handleResize = useCallback\(\(\) => \{[\s\S]*?\}, \[terminalId\]\)/,
  `const handleResize = useCallback(() => {
    if (!fitAddonRef.current || !xtermRef.current) return

    try {
      const term = xtermRef.current
      const wasAtBottom = term.buffer.active.viewportY >= term.buffer.active.baseY
      fitAddonRef.current.fit()
      if (wasAtBottom) {
        term.scrollToBottom()
      }
      const { cols, rows } = term
      void window.electronAPI.terminal.resize({ terminalId, cols, rows })
    } catch (error) {
      console.error('[Terminal] Resize failed:', error)
    }
  }, [terminalId])`
);

// We should also replace the fitAddon.fit() inside the fitTimeout with the wasAtBottom logic
file = file.replace(
  /fitAddon\.fit\(\)\n        const \{ cols: nextCols, rows: nextRows \} = term/,
  `const wasAtBottom = term.buffer.active.viewportY >= term.buffer.active.baseY
        fitAddon.fit()
        if (wasAtBottom) {
          term.scrollToBottom()
        }
        const { cols: nextCols, rows: nextRows } = term`
);

fs.writeFileSync('src/features/projects/components/TerminalInstance.tsx', file);

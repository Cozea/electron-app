const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/TerminalInstance.tsx', 'utf8');

// 1. Remove outputChunks from Zustand selector
file = file.replace(
  "const outputChunks = useTerminalStore((state) => state.outputBuffers[terminalId] ?? EMPTY_ARRAY)",
  "// Bypass React renders for output streaming"
);

// 2. Remove the React useEffect that writes outputChunks to xterm
const outputUseEffectRegex = /  useEffect\(\(\) => \{\n    const term = xtermRef\.current\n    if \(\!term\) return\n\n    const renderedCount = renderedOutputCountRef\.current[\s\S]*?\}, \[outputChunks, setTerminalHasOutput, terminalId\]\)/;
file = file.replace(outputUseEffectRegex, "");

// 3. Inject direct output listener into the main Xterm initialization useEffect
const xtermInitRegex = /(    fitAddonRef\.current = fitAddon\n\n)(    const inputDisposable = term\.onData)/;
const injection = `    // Initialize with existing history from Zustand without subscribing to changes
    const existingHistory = useTerminalStore.getState().outputBuffers[terminalId] ?? []
    if (existingHistory.length > 0) {
      term.write(existingHistory.join(''))
    }

    // Stream new data directly from backend, bypassing React renders
    const unsubscribeOutput = window.electronAPI.terminal.onOutput(({ terminalId: eventTerminalId, data }) => {
      if (eventTerminalId === terminalId) {
        term.write(data)
      }
    })

`;
file = file.replace(xtermInitRegex, `$1${injection}$2`);

// 4. Clean up the listener
const cleanupRegex = /      inputDisposable\.dispose\(\)\n      selectionDisposable\.dispose\(\)/;
const cleanupInjection = `      unsubscribeOutput()\n      inputDisposable.dispose()\n      selectionDisposable.dispose()`;
file = file.replace(cleanupRegex, cleanupInjection);

fs.writeFileSync('src/features/projects/components/TerminalInstance.tsx', file);

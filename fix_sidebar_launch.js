const fs = require('fs');

let sidebar = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

// We need to add the terminal to `useTerminalStore` so `TerminalInstance` can track its status and logs properly.
// The `TerminalInstance` relies on the Zustand store for output tracking.

let repl = `  const { addTerminal } = useTerminalStore((state) => state.actions)

  // Launching a new terminal
  const launchAITerminal = async (profileId: string, command: string) => {
    void profileId; if (!projectPath) return
    
    try {
      const result = await window.electronAPI.terminal.create({
        projectPath,
        cwd: projectPath,
        cols: 80,
        rows: 24,
      })

      if (result.success && result.terminalId) {
        // Add to Zustand store so the frontend TerminalInstance can sync with the backend
        addTerminal({
          id: result.terminalId,
          status: 'running',
          nameSource: 'generated',
          title: 'AI Agent',
          label: 'AI Agent',
          kind: 'agent',
          projectPath,
          lastHeartbeatAt: Date.now(),
        })

        setActiveTerminalId(result.terminalId)
        
        if (command) {
          setTimeout(() => {
            window.electronAPI.terminal.input({
              terminalId: result.terminalId!,
              data: command + '\\r',
            })
          }, 300) // Small delay to let shell boot up
        }
      }
    } catch (err) {
      console.error("Failed to launch AI terminal", err)
    }
  }`;

sidebar = sidebar.replace(/\/\/ Launching a new terminal[\s\S]*?console\.error\("Failed to launch AI terminal", err\)\n    \}\n  \}/, repl);
sidebar = sidebar.replace(/import \{ useAITerminalStore \} from '@\/stores\/useAITerminalStore'/, "import { useAITerminalStore } from '@/stores/useAITerminalStore'\nimport { useTerminalStore } from '@/stores/useTerminalStore'");

fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', sidebar);

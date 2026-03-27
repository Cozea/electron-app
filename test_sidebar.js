const fs = require('fs');

let sidebar = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

// A common mistake is missing the `addTerminal` mapping to the zustand state for rendering.
// Let's check the launchAITerminal function.

const launchFunc = `
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
  }
`;
console.log(sidebar.includes('window.electronAPI.terminal.create'));

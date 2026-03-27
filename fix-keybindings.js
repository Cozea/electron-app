const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/TerminalInstance.tsx', 'utf8');

const injection = `
    term.attachCustomKeyEventHandler((event) => {
      // Cmd+K / Ctrl+K to clear terminal natively
      if (event.key === 'k' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        if (event.type === 'keydown') {
          void window.electronAPI.terminal.input({ terminalId, data: '\\u000c' })
        }
        return false
      }

      // Forward Alt/Option+Left/Right as proper escape sequences for word jumping
      if (event.type === 'keydown' && event.altKey && !event.metaKey && !event.ctrlKey) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          void window.electronAPI.terminal.input({ terminalId, data: '\\x1bb' })
          return false
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          void window.electronAPI.terminal.input({ terminalId, data: '\\x1bf' })
          return false
        }
      }

      // Forward Cmd+Left/Right as proper escape sequences for line start/end
      if (event.type === 'keydown' && event.metaKey && !event.altKey && !event.ctrlKey) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          void window.electronAPI.terminal.input({ terminalId, data: '\\x1bOH' })
          return false
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          void window.electronAPI.terminal.input({ terminalId, data: '\\x1bOF' })
          return false
        }
      }

      return true
    })
`;

file = file.replace("term.open(container)", injection + "    term.open(container)");

fs.writeFileSync('src/features/projects/components/TerminalInstance.tsx', file);

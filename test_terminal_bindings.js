const fs = require('fs');
const term = fs.readFileSync('electron/services/TerminalService.ts', 'utf8');

// Ensure that pty.spawn is correctly assigning the ptyProcess into the terminal
if (term.includes('terminal.ptyProcess = ptyProcess')) {
    console.log('Terminal bindings are correct.');
} else {
    console.log('Terminal bindings are MISSING!');
}

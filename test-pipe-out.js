const { spawn } = require('child_process');
const child = spawn('resources/radon/dist/simulator-server-macos', ['ios', '--id', '571DBC5E-01D2-4C67-939C-C620DAC7D085'], {
  stdio: ['ignore', 'pipe', 'pipe'] // This caused immediate exit earlier!
});
// Wait, if stdin is 'ignore', it exits immediately.
// We must use 'pipe' or a real FD for stdin to keep it open.
